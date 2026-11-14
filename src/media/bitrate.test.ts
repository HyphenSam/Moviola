import { Quality } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { PRESET_LEVELS, presetBitrate, type QualityPreset } from '@/lib/bitrate'
import type { VideoEncodeCodec } from '@/lib/capabilities'

// `presetBitrate` repeats a sum Mediabunny keeps private; this catches the day they part.
describe('presetBitrate against Mediabunny', () => {
  const codecs: VideoEncodeCodec[] = ['avc', 'hevc', 'vp9', 'av1']
  const presets: QualityPreset[] = ['smaller', 'balanced', 'high']
  const sizes = [
    [1920, 1080],
    [1280, 720],
    [852, 480],
    [1080, 1920],
    [3840, 2160],
  ]
  it.each(codecs)('agrees for %s at every preset and size', (codec) => {
    for (const preset of presets) {
      for (const [w, h] of sizes) {
        const quality = new Quality(PRESET_LEVELS[preset]) as Quality & {
          _toVideoBitrate(codec: string, width: number, height: number): number
        }
        expect(presetBitrate(codec, w, h, preset)).toBe(quality._toVideoBitrate(codec, w, h))
      }
    }
  })
})
