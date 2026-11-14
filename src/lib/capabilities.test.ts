import { describe, expect, it } from 'vitest'
import { probeCapabilities, videoEncodersAt } from './capabilities'

describe('probeCapabilities', () => {
  it('asks about each video codec at 1080p and each audio codec, natively', async () => {
    const asked: string[] = []
    const caps = await probeCapabilities({
      canEncodeVideo: async (codec, size) => {
        asked.push(`${codec} ${size.width}x${size.height}`)
        return codec === 'avc' || codec === 'vp9'
      },
      canEncodeAudio: async (codec) => codec === 'aac' || codec === 'opus',
      wasm: false,
    })
    expect(asked).toEqual(['avc 1920x1080', 'hevc 1920x1080', 'vp9 1920x1080', 'av1 1920x1080'])
    expect(caps).toEqual({
      encodeVideo: { avc: true, hevc: false, vp9: true, av1: false },
      encodeAudio: { aac: true, opus: true, mp3: false, flac: false },
    })
  })

  it('counts the add-on encoders for MP3, FLAC and AAC where WebAssembly runs', async () => {
    const caps = await probeCapabilities({
      canEncodeVideo: async () => false,
      canEncodeAudio: async () => false,
      wasm: true,
    })
    // Opus has no add-on.
    expect(caps.encodeAudio).toEqual({ aac: true, opus: false, mp3: true, flac: true })
  })

  it('treats a check that throws as a no', async () => {
    const caps = await probeCapabilities({
      canEncodeVideo: async () => {
        throw new Error('no VideoEncoder')
      },
      canEncodeAudio: async () => {
        throw new Error('no AudioEncoder')
      },
      wasm: false,
    })
    expect(caps.encodeVideo).toEqual({ avc: false, hevc: false, vp9: false, av1: false })
    expect(caps.encodeAudio).toEqual({ aac: false, opus: false, mp3: false, flac: false })
  })
})

describe('videoEncodersAt', () => {
  it('asks about each video codec at the given size', async () => {
    const asked: string[] = []
    const encoders = await videoEncodersAt(
      async (codec, size) => {
        asked.push(`${codec} ${size.width}x${size.height}`)
        if (codec === 'av1') throw new Error('no encoder')
        return codec !== 'hevc'
      },
      { width: 720, height: 1280 },
    )
    expect(asked).toEqual(['avc 720x1280', 'hevc 720x1280', 'vp9 720x1280', 'av1 720x1280'])
    expect(encoders).toEqual({ avc: true, hevc: false, vp9: true, av1: false })
  })
})
