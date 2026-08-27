import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: '.',
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5180, // deliberately NOT 5173 — that's the AEGIS web app's dev server
    strictPort: true,
  },
})
