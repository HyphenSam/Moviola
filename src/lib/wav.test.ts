import { describe, expect, it } from 'vitest'
import { WAV_MAX_BYTES, wavBytes } from './wav'

describe('wavBytes', () => {
  it('is the 44-byte header plus every sample of every channel', () => {
    expect(wavBytes(1, 48000, 2, 16)).toBe(44 + 48000 * 2 * 2)
    expect(wavBytes(1, 48000, 6, 24)).toBe(44 + 48000 * 6 * 3)
    expect(wavBytes(2, 8000, 1, 8)).toBe(44 + 16000)
  })

  it('counts a part sample as a whole one', () => {
    expect(wavBytes(0.5 / 48000, 48000, 1, 16)).toBe(44 + 2)
  })

  it('puts 5.1 at 48 kHz past RIFF’s 4 GiB after 83 minutes at 24 bits, 124 at 16', () => {
    expect(WAV_MAX_BYTES).toBe(2 ** 32)
    expect(wavBytes(82 * 60, 48000, 6, 24)).toBeLessThan(WAV_MAX_BYTES)
    expect(wavBytes(83 * 60, 48000, 6, 24)).toBeGreaterThanOrEqual(WAV_MAX_BYTES)
    expect(wavBytes(124 * 60, 48000, 6, 16)).toBeLessThan(WAV_MAX_BYTES)
    expect(wavBytes(125 * 60, 48000, 6, 16)).toBeGreaterThanOrEqual(WAV_MAX_BYTES)
  })
})
