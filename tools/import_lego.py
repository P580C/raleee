#!/usr/bin/env python3
"""
LEGO model import for Raleee: LDraw (.ldr / .mpd, e.g. exported from BrickLink Studio) -> game-ready GLB
with everything the player can't see removed.

It reuses the Brick Snap Lab pipeline (../Brick Build/assets/ldraw_to_glb.py: LDraw parsing, BFC, colours,
palette texture, GLB writer) without changing it. The brick game keeps its full-detail, whole parts. This
game only ever looks down from about 35 degrees, so here:

  * Body / scenery: the model is merged and every triangle that can't be seen from some direction at least
    `--min-elevation` degrees above the horizon is dropped: undersides, tubes, the insides of bricks, and
    faces hidden between touching bricks.
  * Wheels: any submodel whose name contains `--wheel` (default "wheel") becomes its own mesh, placed once
    per use. Wheels spin, so they're only stripped of faces hidden inside the wheel (seen from no direction).
  * Studs use LDraw's 8-sided primitives (`--lowres studs`) unless told otherwise.

Usage (from the repo root):
  tools/.venv/bin/python tools/import_lego.py model.ldr public/models/model.glb

Scenery for the stage editor: add --scenery "Name" and the model is listed in public/models/scenery.json
(next to the output), so the editor's SCENERY tab offers it. --game-scale multiplies the stud size (build
small, show big) and --collide-above sets the height (m) below which the car drives over it (base plates):
  tools/.venv/bin/python tools/import_lego.py ldraw/House.ldr public/models/house.glb --scenery "House"

Set up the venv once:
  python3 -m venv tools/.venv && tools/.venv/bin/pip install numpy pillow trimesh embreex scipy rtree
"""
import argparse
import importlib.util
import json
import math
import os
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_PIPELINE = os.path.normpath(os.path.join(HERE, "..", "..", "Brick Build", "assets", "ldraw_to_glb.py"))
DEFAULT_LIB = "/Applications/Studio 2.0/ldraw"
DEFAULT_LDCONFIG = os.path.normpath(os.path.join(HERE, "..", "..", "Brick Build", ".cache", "LDConfig.ldr"))


def load_pipeline(path):
    spec = importlib.util.spec_from_file_location("ldraw_to_glb", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def view_dirs(n, min_elev_deg):
    """Fibonacci-sphere directions with elevation >= min_elev (None = the whole sphere). glTF space, +Y up."""
    if min_elev_deg is None:
        total = n
    else:
        # Sample the full sphere densely enough that about n directions survive the elevation cut.
        frac = max(0.02, (1 - math.sin(math.radians(min_elev_deg))) / 2)
        total = int(math.ceil(n / frac))
    k = np.arange(total) + 0.5
    phi = np.arccos(1 - 2 * k / total)
    th = math.pi * (1 + 5 ** 0.5) * k
    D = np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)
    if min_elev_deg is not None:
        D = D[D[:, 1] >= math.sin(math.radians(min_elev_deg))]
    return D


def cull_visible(V, cert, D, samples=4):
    """Keep triangles from which at least one ray in D escapes the model (same method as the pipeline's
    cull_hidden, with the view directions passed in)."""
    import trimesh
    from trimesh.ray.ray_pyembree import RayMeshIntersector

    T = len(V)
    if T == 0:
        return np.zeros(0, bool)
    flat = V.reshape(-1, 3)
    mesh = trimesh.Trimesh(flat, np.arange(T * 3).reshape(T, 3), process=False)
    rmi = RayMeshIntersector(mesh)
    fn = np.cross(V[:, 1] - V[:, 0], V[:, 2] - V[:, 0])
    fn /= np.linalg.norm(fn, axis=1)[:, None]
    assert np.isfinite(fn).all(), "degenerate triangles left after drop_degenerate"
    cen = V.mean(1)
    P = [cen] + [cen * 0.4 + V[:, j] * 0.6 for j in range(3)][: samples - 1]
    eps = 1e-4 * float(np.linalg.norm(flat.max(0) - flat.min(0)))
    visible = np.zeros(T, bool)
    for side in (1, -1):  # uncertified (no BFC) triangles are tested from both sides
        for p in P:
            todo = np.where(~visible & (cert | (side == 1)))[0]
            if not len(todo):
                continue
            n = fn[todo] * side
            with np.errstate(all="ignore"):  # numpy 2.0 + Apple Accelerate raises false matmul warnings
                dots = n @ D.T
            ti, di = np.nonzero(dots > 0.02)
            if not len(ti):
                continue
            hit = rmi.intersects_any(p[todo][ti] + n[ti] * eps, D[di])
            esc = np.zeros(len(todo), bool)
            np.logical_or.at(esc, ti, ~hit)
            visible[todo[esc]] = True
    return visible


def wheel_dirs(n, axle_out):
    """View directions for a wheel that spins about `axle_out` (unit, pointing away from the car): every
    direction on its outer side, plus a little past edge-on. The inner face points under the car."""
    D = view_dirs(n * 2, None)
    return D[D @ axle_out >= -0.15]


def split_lines(lib, lines, pattern):
    """Top-level lines of the main model -> (body lines, wheel placements [(submodel, colour, matrix)])."""
    body, wheels = [], []
    for raw in lines:
        t = raw.split()
        if len(t) >= 15 and t[0] == "1":
            name = " ".join(t[14:]).replace("\\", "/").lower()
            ref = lib.find(name)
            if ref and ref[0] == "inline" and pattern in name:
                code = int(t[1], 0) if t[1].startswith("0x") else int(t[1])
                x, y, z, a, b, c, d, e, f, g, h, i = map(float, t[2:14])
                M = np.array([[a, b, c, x], [d, e, f, y], [g, h, i, z], [0, 0, 0, 1]])
                wheels.append((name, code, M))
                continue
        body.append(raw)
    return body, wheels


def flatten(L, fl, pal, lines, colour, C):
    soup = fl.flatten_lines(lines, colour, np.eye(4), False, True, [])
    V, col, cert = L.drop_degenerate(*L.soup_to_arrays(soup, C))
    return V, np.array([pal.resolve(c) for c in col]), cert


def build_piece(L, fl, pal, lines, colour, C, D, stats, label, flat=None):
    V, col, cert = flat if flat is not None else flatten(L, fl, pal, lines, colour, C)
    before = int(len(V))
    if len(V):
        vis = cull_visible(V, cert, D)
        V, col = V[vis], col[vis]
    prims = L.build_indexed(V, col, pal) if len(V) else {}
    stats[label] = {"tris_flattened": before, "tris_final": L.tri_count(prims)}
    return prims


def run(args):
    t0 = time.time()
    L = load_pipeline(args.pipeline)
    lib = L.Library(args.lib, lowres=args.lowres)
    ldconfig = args.ldconfig if args.ldconfig and os.path.exists(args.ldconfig) else os.path.join(args.lib, "LDConfig.ldr")
    pal = L.Palette(L.load_ldconfig(ldconfig))
    fl = L.Flattener(lib, pal, None)
    main = lib.load_model(args.input)
    s = args.scale
    C = np.diag([s, -s, -s])  # LDraw -Y up (LDU) -> glTF +Y up, right handed (as the pipeline)
    Cs = np.eye(4)
    Cs[:3, :3] = C
    Ci = np.linalg.inv(Cs)
    glb = L.GLB()
    glb.materials(pal)
    stats = {"input": os.path.basename(args.input), "lowres": args.lowres, "min_elevation": args.min_elevation}

    body_lines, wheels = split_lines(lib, main, args.wheel.lower())
    body = build_piece(L, fl, pal, body_lines, 16, C, view_dirs(args.dirs, args.min_elevation), stats, "body")
    m = glb.mesh(body, "body")
    if m is not None:
        glb.node(m, "body", extras={"role": "body"})

    # Wheels: one mesh per (submodel, colour). The axle is the wheel's thinnest axis; if every use of a
    # wheel mesh agrees which end of it faces away from the car, its inner half is culled too.
    wheel_meshes = {}
    centre = np.zeros(3)
    if body_lines:
        Vb = flatten(L, fl, pal, body_lines, 16, C)[0]
        if len(Vb):
            centre = (Vb.reshape(-1, 3).max(0) + Vb.reshape(-1, 3).min(0)) / 2
    groups = {}
    for idx, (name, code, M) in enumerate(wheels):
        groups.setdefault((name, code), []).append((idx, Cs @ M @ Ci))
    nodes = []
    for (name, code), uses in groups.items():
        flat = flatten(L, fl, pal, lib.lines(("inline", name)), code, C)
        pts = flat[0].reshape(-1, 3)
        axis = int(np.argmin(pts.max(0) - pts.min(0)) if len(pts) else 2)
        signs = set()
        for _, W in uses:
            world_axle = W[:3, axis]
            signs.add(np.sign(float(world_axle @ (W[:3, 3] - centre))) or 1.0)
        if len(signs) == 1:
            out = np.zeros(3)
            out[axis] = signs.pop()
            dirs, how = wheel_dirs(args.dirs, out), "outer half"
        else:
            dirs, how = view_dirs(args.dirs, None), "all round (mirrored uses)"
        label = f"wheel:{name}:{code}"
        prims = build_piece(L, fl, pal, None, code, C, dirs, stats, label, flat)
        stats[label]["culled"] = how
        mesh = glb.mesh(prims, f"wheel_{len(wheel_meshes)}")
        wheel_meshes[(name, code)] = mesh
        for idx, W in uses:
            nodes.append((idx, mesh, W, name))
    for idx, mesh, W, name in sorted(nodes, key=lambda x: x[0]):
        glb.node(mesh, f"wheel_{idx}", W, {"role": "wheel", "submodel": name})

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    glb.save(args.output)
    stats["wheels"] = len(wheels)
    stats["tris_drawn"] = stats["body"]["tris_final"] + sum(
        stats[f"wheel:{n}:{c}"]["tris_final"] for n, c, _ in wheels
    )
    stats["bytes"] = os.path.getsize(args.output)
    stats["missing_parts"] = sorted(fl.missing)
    stats["seconds"] = round(time.time() - t0, 2)
    if args.scenery:
        stats["scenery"] = add_to_catalog(args)
    print(json.dumps(stats))
    return stats


def add_to_catalog(args):
    """Add (or update) this model in scenery.json next to the output GLB. Returns the entry."""
    out_dir = os.path.dirname(os.path.abspath(args.output))
    path = os.path.join(out_dir, "scenery.json")
    entries = []
    if os.path.exists(path):
        with open(path) as f:
            entries = json.load(f)
    file = os.path.basename(args.output)
    entry = {
        "id": os.path.splitext(file)[0],
        "name": args.scenery,
        "file": file,
        "scale": args.game_scale,
        "collideAbove": args.collide_above,
    }
    entries = [e for e in entries if e.get("id") != entry["id"]] + [entry]
    with open(path, "w") as f:
        f.write("[\n" + ",\n".join("  " + json.dumps(e) for e in entries) + "\n]\n")
    return entry


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--pipeline", default=DEFAULT_PIPELINE, help="path to the Brick Snap Lab ldraw_to_glb.py")
    ap.add_argument("--lib", default=DEFAULT_LIB, help="LDraw library root (Studio's by default)")
    ap.add_argument("--ldconfig", default=DEFAULT_LDCONFIG, help="current LDraw.org LDConfig.ldr (matches palette.json)")
    ap.add_argument("--lowres", choices=["none", "studs", "all"], default="studs")
    ap.add_argument("--min-elevation", type=float, default=15.0,
                    help="lowest view angle above the horizon to keep faces for (degrees). The camera is at "
                         "35 degrees; the margin covers body roll, pitch and jumps.")
    ap.add_argument("--wheel", default="wheel", help="submodels whose name contains this are exported as wheels")
    ap.add_argument("--dirs", type=int, default=96, help="view directions tested per triangle")
    ap.add_argument("--scale", type=float, default=1 / 20, help="1 unit = 1 stud pitch by default")
    ap.add_argument("--scenery", metavar="NAME", help="list the model in scenery.json for the stage editor")
    ap.add_argument("--game-scale", type=float, default=1.0, help="scenery: stud-size multiplier in the game")
    ap.add_argument("--collide-above", type=float, default=0.3,
                    help="scenery: parts lower than this (m) don't block the car")
    args = ap.parse_args()
    if not os.path.exists(args.pipeline):
        sys.exit(f"pipeline not found: {args.pipeline}")
    run(args)


if __name__ == "__main__":
    main()
