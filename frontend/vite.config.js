import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // In dev, short links (/s/<code>) are served by Django just like the API,
  // so proxy them to the same backend the SPA talks to.
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_API_BASE_URL || 'http://backend:8000'

  return {
    plugins: [react()],
    build: {
      target: ['es2015', 'safari13'],
      cssTarget: ['safari13'],
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: ['localhost', '127.0.0.1', 'vnutour.hunn.io.vn'],
      proxy: {
        '/api': { target: backend, changeOrigin: true },
        '/media': { target: backend, changeOrigin: true },
        '/s': { target: backend, changeOrigin: true },
      },
      watch: {
        usePolling: true,
        interval: 100,
      },
      hmr: {
        host: 'localhost',
        port: 5173,
        protocol: 'ws',
      },
    },
  }
})