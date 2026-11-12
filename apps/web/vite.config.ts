import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A new deployment is picked up on the next visit; everything stays usable offline.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'CS Lab Toolkit',
        short_name: 'CS Lab',
        description:
          'Open source, browser-based tools for operating systems, C and Python, data structures and databases.',
        theme_color: '#4f46e5',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,wasm}'],
        navigateFallback: '/index.html',
        // The code editor and graph libraries make some chunks large; cache them anyway.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // The real Python and C toolchains come from jsDelivr on first use; keep them for offline.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/cdn\.jsdelivr\.net\/npm\/(pyodide|@yowasp)\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'toolchains',
              expiration: { maxEntries: 40 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  build: { chunkSizeWarningLimit: 1200 },
  // Module workers, so the code runner can import() Python and clang from the CDN.
  worker: { format: 'es' },
});
