import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: '/kan/',
  server: { host: true },
  // Pre-bundling would duplicate MathJax modules, and the glyph ranges would register on a copy of the font.
  optimizeDeps: { exclude: ['@mathjax/src', '@mathjax/mathjax-newcm-font'] },
  build: {
    rolldownOptions: {
      output: {
        // MathJax and its glyph ranges (~10 MB) go apart, out of the precache: see runtimeCaching below.
        chunkFileNames: (chunk) =>
          chunk.moduleIds.some((id) => id.includes('/node_modules/@mathjax/'))
            ? 'assets/mathjax/[name]-[hash].js'
            : 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      workbox: {
        globIgnores: ['assets/mathjax/**'],
        // Hashed names never change: cached at first use, math then renders offline.
        runtimeCaching: [
          {
            urlPattern: /\/assets\/mathjax\//,
            handler: 'CacheFirst',
            options: { cacheName: 'mathjax', expiration: { maxEntries: 100 } },
          },
        ],
      },
      manifest: {
        name: 'Issues',
        short_name: 'Issues',
        description: 'Minimal issue tracker synced across devices',
        theme_color: '#1f2b42',
        background_color: '#1f2b42',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
})
