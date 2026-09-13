import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Cloudflare Rocket Loader rewrites `type="module"` into a placeholder type and
// re-loads the script with its own loader, which cannot handle ES modules: the
// hashed bundle comes back ERR_ABORTED 404 and the app never boots. The
// documented opt-out is `data-cfasync="false"` on the tag, but Vite drops
// unknown attributes from the entry <script> when it rewrites index.html, so
// the attribute has to be re-applied to the tags Vite emits.
function cloudflareRocketLoaderOptOut() {
  return {
    name: 'cloudflare-rocket-loader-opt-out',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        /<script(?![^>]*\sdata-cfasync=)/g,
        '<script data-cfasync="false"',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // In dev, short links (/s/<code>) are served by Django just like the API,
  // so proxy them to the same backend the SPA talks to.
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_API_BASE_URL || 'http://backend:8000'

  return {
    plugins: [react(), cloudflareRocketLoaderOptOut()],
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
        // Match short links only; '/s' also proxies Vite's /src modules.
        '^/s/': { target: backend, changeOrigin: true },
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
