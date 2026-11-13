import { describe, expect, it } from 'vitest'
import { readVolume, writeVolume } from './settings'

/** Storage backed by a Map, like localStorage in the ways these functions use it. */
function fakeStorage() {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
  }
}

const broken = {
  getItem: () => {
    throw new Error('blocked')
  },
  setItem: () => {
    throw new Error('blocked')
  },
}

describe('volume', () => {
  it('is half by default', () => {
    expect(readVolume(fakeStorage())).toBe(0.5)
  })

  it('reads back what was written', () => {
    const storage = fakeStorage()
    writeVolume(storage, 0.25)
    expect(readVolume(storage)).toBe(0.25)
    writeVolume(storage, 0)
    expect(readVolume(storage)).toBe(0)
  })

  it('falls back to half for anything that isn’t a volume', () => {
    for (const stored of ['loud', '1.5', '-1', '']) {
      const storage = fakeStorage()
      storage.setItem('moviola.volume', stored)
      expect(readVolume(storage)).toBe(0.5)
    }
  })

  it('works without storage, or when the browser blocks it', () => {
    expect(readVolume(null)).toBe(0.5)
    expect(readVolume(broken)).toBe(0.5)
    expect(() => writeVolume(broken, 0.3)).not.toThrow()
    expect(() => writeVolume(null, 0.3)).not.toThrow()
  })
})
