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
      '/statsplus': {
        target: 'https://atl-01.statsplus.net',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/statsplus/, ''),
      }
    }
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
