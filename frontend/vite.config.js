import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // In dev, short links (/s/<code>) are served by Django just like the API,
  // so proxy them to the same backend the SPA talks to.
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_API_BASE_URL || 'http://localhost:8080'

  return {
    plugins: [react()],
    server: {
      host: true, // bind dev server to all network interfaces
      allowedHosts: ['vnutour.hunn.io.vn'],
      proxy: {
        '/s': { target: backend, changeOrigin: true },
      },
    },
  }
})
