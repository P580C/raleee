/**
 * Every stage the menu can offer: the built-in ones (JSON in this folder) plus the player's own, made in the
 * editor and kept in localStorage. Piece-built stages are converted to the sim's spline format on load.
 */
import { piecesToTrackData, type PieceTrackData } from '../sim/pieces'
import type { TrackData } from '../sim/track'
import classic from './stage1.json'
import sprint from './sprint.json'
import valley from './valley.json'

export interface TrackEntry {
  id: string
  name: string
  builtIn: boolean
  source: TrackData | PieceTrackData
}

const BUILT_IN: TrackEntry[] = [
  { id: 'valley', name: 'Valley Run', builtIn: true, source: valley as PieceTrackData },
  { id: 'sprint', name: 'Sprint', builtIn: true, source: sprint as PieceTrackData },
  { id: 'classic', name: 'Classic', builtIn: true, source: { ...(classic as TrackData), name: 'Classic' } },
]

const KEY = 'raleee.userTracks'

export function isPieceTrack(src: TrackData | PieceTrackData): src is PieceTrackData {
  return (src as PieceTrackData).format === 'pieces'
}

export function trackDataOf(e: TrackEntry): TrackData {
  return isPieceTrack(e.source) ? piecesToTrackData(e.source) : e.source
}

function loadUser(): TrackEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const list = JSON.parse(raw) as { id: string; data: PieceTrackData }[]
    return list
      .filter((t) => t && t.data && Array.isArray(t.data.pieces))
      .map((t) => ({ id: t.id, name: t.data.name || 'Untitled', builtIn: false, source: t.data }))
  } catch {
    return []
  }
}

function saveUser(list: TrackEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.map((t) => ({ id: t.id, data: t.source }))))
  } catch {
    /* storage full or blocked: the track lives until reload */
  }
}

export function listTracks(): TrackEntry[] {
  return [...BUILT_IN, ...loadUser()]
}

export function findTrack(id: string): TrackEntry | undefined {
  return listTracks().find((t) => t.id === id)
}

/** Save a player's stage; returns its id (a new one if `id` is null or a built-in). */
export function saveUserTrack(id: string | null, data: PieceTrackData): string {
  const list = loadUser()
  const existing = id ? list.findIndex((t) => t.id === id) : -1
  const entry: TrackEntry = { id: existing >= 0 ? id! : `user-${Date.now().toString(36)}`, name: data.name, builtIn: false, source: data }
  if (existing >= 0) list[existing] = entry
  else list.push(entry)
  saveUser(list)
  return entry.id
}

export function deleteUserTrack(id: string): void {
  saveUser(loadUser().filter((t) => t.id !== id))
}
