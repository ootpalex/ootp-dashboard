import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Dynamic StatsPlus proxy. URL shape: /sp/<host>/<rest>
      // The first path segment after /sp/ is the StatsPlus host, so each league
      // can hit its own host (atl-01.statsplus.net vs statsplus.net vs custom
      // subdomains) without a hard-coded proxy entry per host. `router` picks
      // the target per request; `rewrite` strips /sp/<host> so the upstream
      // sees a normal /...api/... path.
      '/sp': {
        target: 'http://placeholder.invalid', // overridden per request by router
        changeOrigin: true,
        secure: true,
        router: (req) => {
          const m = req.url.match(/^\/sp\/([^/]+)/);
          return m ? `https://${m[1]}` : 'https://atl-01.statsplus.net';
        },
        rewrite: (path) => path.replace(/^\/sp\/[^/]+/, ''),
      },
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
