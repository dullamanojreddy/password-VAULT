import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // teammate's FastAPI runs on :8000 — frontend calls /api/* and it just works
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
