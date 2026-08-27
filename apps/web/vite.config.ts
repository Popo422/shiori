import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Shiori',
        short_name: 'Shiori',
        description: 'An illustrated reader for EPUB and PDF.',
        theme_color: '#12100e',
        background_color: '#12100e',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        // Take over as soon as a new version is deployed. Without these, an open
        // tab keeps serving the previously cached bundle until every tab is
        // closed, so a deployed fix looks like it did nothing.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Illustrations are immutable once generated — cache them hard so a
        // re-read of a book works fully offline.
        runtimeCaching: [
          {
            // Only the image endpoint: /api/art/{book}/{beat}. A looser pattern
            // also matched /api/art/regenerate, so a re-roll got a stale cached
            // reply and the plate never changed.
            urlPattern: /\/api\/art\/[^/]+\/[^/]+$/,
            method: 'GET',
            handler: 'CacheFirst',
            options: {
              cacheName: 'shiori-art',
              expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Local API runs on wrangler dev; same-origin in production.
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: true } },
  },
});
