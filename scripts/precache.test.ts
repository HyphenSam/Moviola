import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { unprecached } from './precache.ts'

describe('unprecached', () => {
  it('lists built files the service worker would leave out, so the app can’t run offline', () => {
    const dir = mkdtempSync(join(tmpdir(), 'precache-'))
    mkdirSync(join(dir, 'assets'))
    for (const file of ['index.html', 'assets/app.js', 'assets/encoder.js', 'assets/codec.wasm', 'icon.png'])
      writeFileSync(join(dir, file), 'x')
    // The worker itself, its runtime and the host's headers are never precached.
    for (const file of ['sw.js', 'workbox-1a2b3c.js', '_headers']) writeFileSync(join(dir, file), 'x')
    const sw =
      'e.precacheAndRoute([{url:"index.html",revision:"1"},{url:"assets/app.js",revision:null},{url:"icon.png",revision:"2"}])'
    expect(unprecached(dir, sw)).toEqual(['assets/codec.wasm', 'assets/encoder.js'])
  })
})
