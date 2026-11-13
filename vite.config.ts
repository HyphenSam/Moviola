/// <reference types="vitest/config" />
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import { oversized } from './scripts/pages-limit.ts'
import { FILE_TYPES } from './src/lib/file-types.ts'

const root = fileURLToPath(new URL('.', import.meta.url))

// Nothing needs cross-origin isolation yet, but a future ffmpeg.wasm fallback
// will (threads), and keeping it now stops a cross-origin resource from
// sneaking in. public/_headers sets the same in production.
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

/** Fails the build if Cloudflare would refuse a file (static assets are capped at 25 MiB each). */
function pagesLimit(): Plugin {
  return {
    name: 'pages-limit',
    apply: 'build',
    closeBundle() {
      const big = oversized(join(root, 'dist'))
      if (big.length) {
        throw new Error(
          `Over Cloudflare's 25 MiB asset limit: ${big.map((f) => `${f.path} (${f.size} bytes)`).join(', ')}`,
        )
      }
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Moviola',
        short_name: 'Moviola',
        description: 'Everyday video tools that run on your device. Nothing is uploaded.',
        lang: 'en-GB',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#141416',
        theme_color: '#141416',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        file_handlers: [{ action: '/', accept: FILE_TYPES }],
      },
      workbox: {
        // Everything, the encoder add-ons' wasm included, so the whole app works offline once installed.
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    pagesLimit(),
  ],
  resolve: {
    alias: { '@': join(root, 'src') },
  },
  worker: { format: 'es' },
  server: { headers: isolation },
  preview: { headers: isolation },
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
  },
})
