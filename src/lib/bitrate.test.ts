import { describe, expect, it } from 'vitest'
import {
  bitsPerPixel,
  canCapFrameRate,
  canScaleTo,
  cappedFrameRate,
  defaultTargetMB,
  MIN_BITS_PER_PIXEL,
  presetBitrate,
  scaledSize,
  targetVideoBitrate,
} from './bitrate'

describe('targetVideoBitrate', () => {
  it('leaves 2% for the container and takes the audio out', () => {
    // 10 MB over 60 s with 128 kbps audio: (80,000,000 × 0.98 − 7,680,000) / 60.
    expect(targetVideoBitrate(10_000_000, 60, 128_000)).toBe(1_178_666)
  })

  it('gives the whole budget to the video when there’s no audio', () => {
    expect(targetVideoBitrate(25_000_000, 100, 0)).toBe(1_960_000)
  })

  it('goes to zero or below when the audio alone fills the target', () => {
    expect(targetVideoBitrate(1_000_000, 120, 128_000)).toBeLessThanOrEqual(0)
  })

  it('is zero for a file with no length', () => {
    expect(targetVideoBitrate(10_000_000, 0, 128_000)).toBe(0)
  })

  it('rounds down to a whole number of bits, as Mediabunny needs', () => {
    expect(Number.isInteger(targetVideoBitrate(8_000_000, 7, 96_000))).toBe(true)
  })
})

describe('bitsPerPixel', () => {
  it('is the bitrate shared over every pixel of every frame', () => {
    expect(bitsPerPixel(1_244_160, 1920, 1080, 30)).toBeCloseTo(0.02)
  })

  it('assumes 30 fps when the frame rate isn’t known', () => {
    expect(bitsPerPixel(1_244_160, 1920, 1080, null)).toBeCloseTo(0.02)
  })

  it('has a floor of 0.02', () => {
    expect(MIN_BITS_PER_PIXEL).toBe(0.02)
  })
})

describe('scaledSize', () => {
  it('scales landscape video so its height is the chosen number', () => {
    expect(scaledSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 })
    expect(scaledSize(1920, 1080, 480)).toEqual({ width: 852, height: 480 })
  })

  it('scales portrait video so its width is the chosen number', () => {
    expect(scaledSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 })
    expect(scaledSize(1080, 2340, 480)).toEqual({ width: 480, height: 1040 })
  })

  it('works from the display size, so rotated phone video (stored landscape, shown portrait) scales by its width', () => {
    // MediaInfo's size is after rotation: a 1920 × 1080 recording turned 90° is 1080 × 1920.
    expect(scaledSize(1080, 1920, 720)).toEqual({ width: 720, height: 1280 })
  })

  it('rounds each side down to an even number', () => {
    expect(scaledSize(1918, 1080, 720)).toEqual({ width: 1278, height: 720 })
    expect(scaledSize(1440, 1081, 1080)).toEqual({ width: 1438, height: 1080 })
    expect(scaledSize(853, 480, 480)).toEqual({ width: 852, height: 480 })
  })

  it('keeps the original size, made even, for Original', () => {
    expect(scaledSize(1920, 1080, null)).toEqual({ width: 1920, height: 1080 })
    expect(scaledSize(1921, 1081, null)).toEqual({ width: 1920, height: 1080 })
  })

  it('never scales up', () => {
    expect(scaledSize(854, 480, 720)).toEqual({ width: 854, height: 480 })
    expect(scaledSize(480, 854, 1080)).toEqual({ width: 480, height: 854 })
  })

  it('keeps square video square', () => {
    expect(scaledSize(1080, 1080, 720)).toEqual({ width: 720, height: 720 })
  })

  it('never makes a side smaller than 2', () => {
    expect(scaledSize(4000, 2, 480)).toEqual({ width: 4000, height: 2 })
    expect(scaledSize(1, 1, null)).toEqual({ width: 2, height: 2 })
  })
})

describe('canScaleTo', () => {
  it('allows sizes up to the source’s shorter side', () => {
    expect(canScaleTo(1920, 1080, 1080)).toBe(true)
    expect(canScaleTo(1920, 1080, 720)).toBe(true)
    expect(canScaleTo(1280, 720, 1080)).toBe(false)
  })

  it('measures portrait video by its width', () => {
    expect(canScaleTo(720, 1280, 720)).toBe(true)
    expect(canScaleTo(720, 1280, 1080)).toBe(false)
  })
})

describe('frame rate capping', () => {
  it('caps a faster source', () => {
    expect(cappedFrameRate(60, 30)).toBe(30)
    expect(cappedFrameRate(29.97, 24)).toBe(24)
    expect(canCapFrameRate(60, 30)).toBe(true)
  })

  it('never raises it: a source at or below the cap keeps its own rate', () => {
    expect(cappedFrameRate(25, 30)).toBeNull()
    expect(cappedFrameRate(30, 30)).toBeNull()
    expect(cappedFrameRate(23.976, 24)).toBeNull()
    expect(canCapFrameRate(25, 30)).toBe(false)
    expect(canCapFrameRate(30, 30)).toBe(false)
  })

  it('keeps the source’s rate for Original', () => {
    expect(cappedFrameRate(60, null)).toBeNull()
  })

  it('caps a source whose rate isn’t known, which may be variable', () => {
    expect(cappedFrameRate(null, 30)).toBe(30)
    expect(canCapFrameRate(null, 24)).toBe(true)
  })
})

describe('presetBitrate', () => {
  // Mediabunny's own sums (`src/media/bitrate.test.ts` checks these against it): 3 Mbps at 1080p for
  // H.264 scaled by the quality level, less for the newer codecs.
  it('follows Mediabunny’s quality levels', () => {
    expect(presetBitrate('avc', 1920, 1080, 'balanced')).toBe(3_227_000)
    expect(presetBitrate('avc', 1920, 1080, 'smaller')).toBe(1_705_000)
    expect(presetBitrate('avc', 1920, 1080, 'high')).toBe(6_111_000)
  })

  it('is lower for the more efficient codecs', () => {
    expect(presetBitrate('hevc', 1920, 1080, 'balanced')).toBe(1_937_000)
    expect(presetBitrate('vp9', 1920, 1080, 'balanced')).toBe(1_937_000)
    expect(presetBitrate('av1', 1920, 1080, 'balanced')).toBe(1_291_000)
  })

  it('scales a little less than the pixel count', () => {
    const p720 = presetBitrate('avc', 1280, 720, 'balanced')
    expect(p720).toBeLessThan(3_227_000)
    expect(p720).toBeGreaterThan(3_227_000 * (4 / 9))
  })
})

describe('defaultTargetMB', () => {
  it('is half the source, rounded to a whole MB', () => {
    expect(defaultTargetMB(50_000_000)).toBe(25)
    expect(defaultTargetMB(41_000_000)).toBe(21)
    expect(defaultTargetMB(12_345_678)).toBe(6)
  })

  it('is at least 1 MB', () => {
    expect(defaultTargetMB(800_000)).toBe(1)
  })
})
