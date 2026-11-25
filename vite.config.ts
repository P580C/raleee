import { defineConfig } from 'vite'

export default defineConfig({
  // Relative base so the build works from any path (GitHub Pages serves it under /raleee/).
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020' },
})
