// vite.config.js — Configuración del bundler para desarrollo y producción.
//
// PROXY DE DESARROLLO:
//   Cuando corres `npm run dev`, Vite sirve el frontend en :5173.
//   Las llamadas a /api/* se redirigen automáticamente a Express en :3001.
//   Esto evita errores de CORS en desarrollo sin tocar el código de la app.
//   En producción (npm start), Express sirve tanto la API como el frontend,
//   por lo que el proxy no aplica.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
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
