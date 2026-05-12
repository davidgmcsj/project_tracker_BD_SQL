import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo, redirige /api al servidor Express en :3001
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
