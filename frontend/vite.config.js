import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // bind dev server to all network interfaces
    allowedHosts: ['vnutour.hunn.io.vn'],
  },
})
