import { describe, expect, it } from 'vitest'
import { playerColourSpace } from './colour'

const BT601 = { primaries: 'smpte170m', transfer: 'smpte170m', matrix: 'smpte170m' } as const
const BT709 = { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709' } as const

describe('playerColourSpace', () => {
  it('leaves a fully tagged track alone', () => {
    expect(playerColourSpace('avc', { ...BT601, fullRange: false }, 1080)).toBeNull()
    expect(playerColourSpace('avc', { ...BT709, fullRange: false }, 180)).toBeNull()
  })

  it('takes untagged H.264, HEVC and VP8 under 720 lines as BT.601, as players do', () => {
    for (const codec of ['avc', 'hevc', 'vp8'] as const) {
      expect(playerColourSpace(codec, { fullRange: false }, 180)).toEqual({ ...BT601, fullRange: false })
      expect(playerColourSpace(codec, {}, 718)).toEqual({ ...BT601, fullRange: false })
    }
  })

  it('takes untagged video of 720 lines or more as BT.709', () => {
    expect(playerColourSpace('avc', { fullRange: false }, 720)).toEqual({ ...BT709, fullRange: false })
    // Coded height: a portrait 720×1280 is HD.
    expect(playerColourSpace('hevc', {}, 1280)).toEqual({ ...BT709, fullRange: false })
  })

  it('takes untagged VP9 and AV1 as BT.709 at any size', () => {
    expect(playerColourSpace('vp9', {}, 360)).toEqual({ ...BT709, fullRange: false })
    expect(playerColourSpace('av1', { fullRange: false }, 180)).toEqual({ ...BT709, fullRange: false })
  })

  it('ignores a partial tag, as Chrome’s player does, and guesses the lot', () => {
    expect(playerColourSpace('avc', { matrix: 'bt709', fullRange: false }, 360)).toEqual({ ...BT601, fullRange: false })
    expect(playerColourSpace('avc', { matrix: 'smpte170m', primaries: null }, 720)).toEqual({
      ...BT709,
      fullRange: false,
    })
  })

  it('keeps the range', () => {
    expect(playerColourSpace('avc', { fullRange: true }, 180)).toEqual({ ...BT601, fullRange: true })
  })

  it('leaves a track of unknown codec alone when it can’t tell', () => {
    expect(playerColourSpace(null, {}, 180)).toBeNull()
  })
})
