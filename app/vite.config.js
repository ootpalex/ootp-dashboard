import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import https from 'node:https'

// Dynamic StatsPlus proxy. URL shape: /sp/<host>/<rest>
// Each league can hit its own StatsPlus host (atl-01.statsplus.net,
// statsplus.net, custom subdomains) without a hard-coded entry per host.
// Implemented as a custom plugin because Vite uses http-proxy-3, which does
// not support http-proxy-middleware's `router` field — using server.proxy
// here would silently fall back to a placeholder target.
function statsplusDynamicProxyPlugin() {
  return {
    name: 'statsplus-dynamic-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = req.url && req.url.match(/^\/sp\/([^/]+)(\/.*)?$/)
        if (!m) return next()
        const host = m[1]
        const path = m[2] || '/'
        const headers = { ...req.headers, host }
        delete headers['connection']
        delete headers['upgrade']
        delete headers['origin']
        delete headers['referer']
        const upstream = https.request({
          host,
          port: 443,
          method: req.method,
          path,
          headers,
        }, (upRes) => {
          res.writeHead(upRes.statusCode || 502, upRes.headers)
          upRes.pipe(res)
        })
        upstream.on('error', (err) => {
          console.error(`[sp proxy] ${host}${path}: ${err.message}`)
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'text/plain' })
            res.end('StatsPlus proxy error: ' + err.message)
          } else {
            res.end()
          }
        })
        req.pipe(upstream)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), statsplusDynamicProxyPlugin()],
  optimizeDeps: {
    include: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Back-compat: any /statsplus prefix still proxies to the original
      // SSB host so old persisted URLs keep working.
      '/statsplus': {
        target: 'https://atl-01.statsplus.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/statsplus/, ''),
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          recharts: ['recharts'],
          'dnd-kit': ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
        },
      },
    },
  },
})
