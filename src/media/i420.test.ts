import { ALL_FORMATS, BlobSource, Input, VideoSample } from 'mediabunny'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { asBt709, decodesToRgb } from './i420'

// Firefox's encoders turn RGB frames (all its decoder hands out, and every resized frame) into YUV with
// BT.601 but report BT.709, which the output is tagged with, so its re-encodes played 31–52% of pixels
// off. Both browsers' encoders take YUV frames as they are. The conversion itself runs in WebGL, so it's
// checked in the browsers; these check what's left alone.
describe('asBt709', () => {
  it('hands the encoder YUV frames as they are', () => {
    const sample = new VideoSample(new Uint8Array(24), { format: 'I420', codedWidth: 4, codedHeight: 4, timestamp: 0 })
    expect(asBt709(sample)).toBe(sample)
  })

  it('leaves RGB frames to the encoder where WebGL 2 is missing', () => {
    const sample = new VideoSample(new Uint8Array(64), { format: 'RGBA', codedWidth: 4, codedHeight: 4, timestamp: 0 })
    expect(asBt709(sample)).toBe(sample)
  })
})

describe('decodesToRgb', () => {
  it('is false where the track can’t be decoded', async () => {
    const file = readFileSync(join(import.meta.dirname, '../../fixtures/h264-aac.mp4'))
    const input = new Input({ source: new BlobSource(new Blob([file])), formats: ALL_FORMATS })
    expect(await decodesToRgb((await input.getPrimaryVideoTrack())!)).toBe(false)
  })
})
