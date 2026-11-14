import { describe, expect, it } from 'vitest'
import { CONTAINER_CODECS } from '@/media/formats'
import type { Capabilities } from '../capabilities'
import { ALL_CAPABLE, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '../testing'
import {
  codecOptions,
  DEFAULT_COMPRESS,
  effectiveCompress,
  frameRateOptions,
  outputSize,
  planCompress,
  resolutionOptions,
  type CompressSettings,
} from './compress'

const settings = (over: Partial<CompressSettings> = {}): CompressSettings => ({
  ...DEFAULT_COMPRESS,
  targetMB: 10,
  ...over,
})
const plan = (info = fakeInfo(), over: Partial<CompressSettings> = {}, caps: Capabilities = ALL_CAPABLE) =>
  planCompress(info, settings(over), CONTAINER_CODECS, caps)
const without = (codecs: Partial<Capabilities['encodeVideo']>, audio: Partial<Capabilities['encodeAudio']> = {}) => ({
  ...ALL_CAPABLE,
  encodeVideo: { ...ALL_CAPABLE.encodeVideo, ...codecs },
  encodeAudio: { ...ALL_CAPABLE.encodeAudio, ...audio },
})

// A phone video: 1080 × 1920 portrait, 30 fps, 4 minutes, 12 Mbps H.264 with 128 kbps AAC.
const phone = (over: Parameters<typeof fakeVideoTrack>[0] = {}) =>
  fakeInfo({
    name: 'PXL_2026.mp4',
    size: 364_000_000,
    duration: 240,
    tracks: [
      fakeVideoTrack({ width: 1080, height: 1920, rotation: 90, frameRate: 30, bitrate: 12_000_000, ...over }),
      fakeAudioTrack({ bitrate: 128_000 }),
    ],
  })

describe('defaults', () => {
  it('starts on Quality, Balanced, Original size and frame rate, H.264, audio kept', () => {
    expect(DEFAULT_COMPRESS).toEqual({
      aim: 'quality',
      preset: 'balanced',
      resolution: 'original',
      frameRate: 'original',
      codec: 'avc',
      audio: 'keep',
    })
  })
})

describe('planCompress, Quality', () => {
  // The presets are bitrates, Mediabunny's for its quality levels, so the result is as predictable as a
  // single pass allows. Left as quality levels, Mediabunny encodes at a fixed quantizer instead, and a
  // noisy phone video at High came out 63% larger than it went in.
  it('re-encodes the video to H.264 in MP4 at Mediabunny’s medium-quality bitrate and copies AAC audio', () => {
    const result = plan(phone())
    expect(result.plan).toEqual({
      kind: 'video',
      container: 'mp4',
      name: 'PXL_2026 (compressed).mp4',
      mimeType: 'video/mp4',
      lossless: false,
      keep: [1, 2],
      video: { codec: 'avc', bitrate: 3_227_000, width: 1080, height: 1920 },
      sizeCheck: { target: null },
    })
    expect(result.caption).toBe('Video re-encoded to H.264, audio copied.')
    expect(result.hints).toBeUndefined()
  })

  it('maps Smaller and High to the low and high levels’ bitrates', () => {
    expect(plan(phone(), { preset: 'smaller' }).plan?.video?.bitrate).toBe(1_705_000)
    expect(plan(phone(), { preset: 'high' }).plan?.video?.bitrate).toBe(6_111_000)
  })

  it('caps the preset at the source’s bitrate when the source is leaner, and warns', () => {
    // Balanced H.264 at 1080p is about 3.2 Mbps; this source is 2 Mbps.
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack({ bitrate: 2_000_000 }), fakeAudioTrack()] }))
    expect(result.plan?.video).toEqual({ codec: 'avc', bitrate: 2_000_000, width: 1920, height: 1080 })
    expect(result.hints).toEqual(['This video is already compact; the result may not be much smaller.'])
  })

  it('compares with the preset at the chosen size, not the source’s', () => {
    // 720p Balanced H.264 is about 1.5 Mbps, so a 2 Mbps 1080p source isn’t capped there.
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack({ bitrate: 2_000_000 })] }), { resolution: '720' })
    expect(result.plan?.video).toEqual({ codec: 'avc', bitrate: 1_494_000, width: 1280, height: 720 })
    expect(result.hints).toBeUndefined()
  })

  it('doesn’t cap when the source’s bitrate isn’t known', () => {
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack({ bitrate: null })] }))
    expect(result.plan?.video?.bitrate).toBe(3_227_000)
  })
})

describe('planCompress, resolution and frame rate', () => {
  it('scales by the shorter side, so portrait phone video becomes 720 wide', () => {
    const result = plan(phone(), { resolution: '720' })
    expect(result.plan?.video).toMatchObject({ width: 720, height: 1280 })
    expect(result.caption).toBe('Video re-encoded to H.264 at 720 × 1280, audio copied.')
  })

  it('rounds an odd source down to even sizes even at Original', () => {
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack({ width: 1279, height: 721 })] }))
    expect(result.plan?.video).toMatchObject({ width: 1278, height: 720 })
  })

  it('caps the frame rate and says so', () => {
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack({ frameRate: 60 })] }), { frameRate: '30' })
    expect(result.plan?.video?.frameRate).toBe(30)
    expect(result.caption).toBe('Video re-encoded to H.264 at 30 fps.')
  })

  it('names both a new size and frame rate', () => {
    const result = plan(phone({ frameRate: 60 }), { resolution: '480', frameRate: '24' })
    expect(result.caption).toBe('Video re-encoded to H.264 at 480 × 852, 24 fps, audio copied.')
  })
})

describe('resolution and frame rate options', () => {
  it('disables sizes above the source', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ width: 1280, height: 720 })] })
    expect(resolutionOptions(info)).toEqual([
      { value: 'original', label: 'Original', disabled: false },
      { value: '1080', label: '1080p', disabled: true },
      { value: '720', label: '720p', disabled: false },
      { value: '480', label: '480p', disabled: false },
    ])
  })

  it('measures portrait and rotated video by its width', () => {
    expect(resolutionOptions(phone()).every((o) => !o.disabled)).toBe(true)
    const narrow = fakeInfo({ tracks: [fakeVideoTrack({ width: 720, height: 1280, rotation: 270 })] })
    expect(resolutionOptions(narrow).find((o) => o.value === '1080')?.disabled).toBe(true)
  })

  it('disables frame rates that would raise it', () => {
    const at25 = fakeInfo({ tracks: [fakeVideoTrack({ frameRate: 25 })] })
    expect(frameRateOptions(at25)).toEqual([
      { value: 'original', label: 'Original', disabled: false },
      { value: '30', label: '30', disabled: true },
      { value: '24', label: '24', disabled: false },
    ])
  })

  it('gives the size the encoders are asked about', () => {
    expect(outputSize(phone(), '480')).toEqual({ width: 480, height: 852 })
    expect(outputSize(phone(), 'original')).toEqual({ width: 1080, height: 1920 })
  })
})

describe('codec', () => {
  it('writes HEVC and AV1 into MP4 and VP9 into WebM', () => {
    expect(plan(phone(), { codec: 'hevc' }).plan).toMatchObject({ container: 'mp4', video: { codec: 'hevc' } })
    expect(plan(phone(), { codec: 'av1' }).plan).toMatchObject({ container: 'mp4', name: 'PXL_2026 (compressed).mp4' })
    expect(plan(phone(), { codec: 'vp9' }).plan).toMatchObject({
      container: 'webm',
      name: 'PXL_2026 (compressed).webm',
      mimeType: 'video/webm',
      video: { codec: 'vp9' },
    })
  })

  it('offers the codecs this browser can encode at the chosen size, H.264 with its caption', () => {
    expect(codecOptions(without({ hevc: false, av1: false }))).toEqual([
      { value: 'avc', label: 'H.264', disabled: false, caption: 'Plays everywhere.' },
      { value: 'hevc', label: 'HEVC', disabled: true, caption: expect.any(String) },
      { value: 'vp9', label: 'VP9', disabled: false, caption: expect.any(String) },
      { value: 'av1', label: 'AV1', disabled: true, caption: expect.any(String) },
    ])
  })

  it('falls back to the first codec it can encode when the chosen one isn’t available', () => {
    const caps = without({ avc: false, hevc: false })
    expect(effectiveCompress(phone(), settings(), caps).codec).toBe('vp9')
    expect(plan(phone(), {}, caps).plan?.video?.codec).toBe('vp9')
  })

  it('says so when this browser can’t encode any of them at this size', () => {
    const caps = without({ avc: false, hevc: false, vp9: false, av1: false })
    expect(plan(phone(), { resolution: '720' }, caps).problems).toEqual([
      'This browser can’t encode video at 720 × 1280.',
    ])
  })

  it('falls back to Original for choices this file can’t take', () => {
    const small = fakeInfo({ tracks: [fakeVideoTrack({ width: 854, height: 480, frameRate: 24 })] })
    expect(effectiveCompress(small, settings({ resolution: '720', frameRate: '30' }), ALL_CAPABLE)).toMatchObject({
      resolution: 'original',
      frameRate: 'original',
    })
  })
})

describe('audio', () => {
  it('encodes audio MP4 can’t hold at 128 kbps AAC when kept', () => {
    // Mediabunny's MP4 writer holds nearly every codec, but not μ-law.
    const info = fakeInfo({
      container: 'mov',
      name: 'call.mov',
      tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ulaw', channels: 1, bitrate: 64_000 })],
    })
    const result = plan(info)
    expect(result.plan?.audio).toEqual({ codec: 'aac', bitrate: 128_000 })
    expect(result.caption).toBe('Video re-encoded to H.264, audio to AAC at 128 kbps.')
  })

  it('encodes audio WebM can’t hold at 128 kbps Opus when kept', () => {
    const result = plan(phone(), { codec: 'vp9' })
    expect(result.plan?.audio).toEqual({ codec: 'opus', bitrate: 128_000 })
    expect(result.caption).toBe('Video re-encoded to VP9, audio to Opus at 128 kbps.')
  })

  it('encodes at 96 kbps for Smaller', () => {
    expect(plan(phone(), { audio: 'smaller' }).plan?.audio).toEqual({ codec: 'aac', bitrate: 96_000 })
    expect(plan(phone(), { audio: 'smaller', codec: 'vp9' }).plan?.audio).toEqual({ codec: 'opus', bitrate: 96_000 })
  })

  it('mixes surround down to stereo when it encodes', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ channels: 6 })] })
    const result = plan(info, { audio: 'smaller' })
    expect(result.plan?.audio).toEqual({ codec: 'aac', bitrate: 96_000, numberOfChannels: 2 })
    expect(result.caption).toBe('Video re-encoded to H.264, audio to stereo AAC at 96 kbps.')
  })

  it('leaves the audio out for Remove', () => {
    const result = plan(phone(), { audio: 'remove' })
    expect(result.plan?.keep).toEqual([1])
    expect(result.plan?.audio).toBeUndefined()
    expect(result.caption).toBe('Video re-encoded to H.264, audio removed.')
  })

  it('says nothing about audio for a silent video', () => {
    const result = plan(fakeInfo({ tracks: [fakeVideoTrack()] }))
    expect(result.caption).toBe('Video re-encoded to H.264.')
  })

  it('keeps every audio track, copying all when the container holds them', () => {
    const info = fakeInfo({
      tracks: [fakeVideoTrack(), fakeAudioTrack({ id: 2 }), fakeAudioTrack({ id: 3, language: 'fra' })],
    })
    expect(plan(info).plan?.keep).toEqual([1, 2, 3])
  })

  it('can’t make audio smaller that this browser can’t decode', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', canDecode: false })] })
    expect(plan(info, { audio: 'smaller' }).problems).toEqual([
      'This browser can’t decode AC-3 audio, so it can’t be made smaller. Keep it or remove it.',
    ])
  })

  it('can’t keep audio the container can’t hold and the browser can’t convert', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', canDecode: false })] })
    expect(plan(info, { codec: 'vp9' }).problems).toEqual([
      'WebM can’t hold AC-3 audio, and this browser can’t decode it to convert it. Remove the audio or choose another codec.',
    ])
  })

  it('needs an Opus encoder for WebM audio', () => {
    expect(plan(phone(), { codec: 'vp9' }, without({}, { opus: false })).problems).toEqual([
      'This browser can’t encode Opus audio, which WebM needs. Remove the audio or choose another codec.',
    ])
  })
})

describe('planCompress, Target size', () => {
  it('works out the video bitrate from the target, less the copied audio', () => {
    // 50 MB over 240 s with 128 kbps audio: (400,000,000 × 0.98 − 30,720,000) / 240.
    const result = plan(phone(), { aim: 'size', targetMB: 50 })
    // At a constant bitrate, which in Chrome landed a 10 MB target at 9.8 MB where a variable one went 1–5% over.
    expect(result.plan?.video).toEqual({
      codec: 'avc',
      bitrate: 1_505_333,
      constantBitrate: true,
      width: 1080,
      height: 1920,
    })
    expect(result.plan?.sizeCheck).toEqual({ target: 50_000_000 })
    expect(result.hints).toEqual(['About 1.5 Mbps for the video.'])
  })

  it('counts encoded audio at the bitrate it’s set to', () => {
    const result = plan(phone(), { aim: 'size', targetMB: 50, audio: 'smaller' })
    expect(result.plan?.video?.bitrate).toBe(Math.floor((400_000_000 * 0.98 - 96_000 * 240) / 240))
  })

  it('gives everything to the video when the audio is removed', () => {
    const result = plan(phone(), { aim: 'size', targetMB: 50, audio: 'remove' })
    expect(result.plan?.video?.bitrate).toBe(Math.floor((400_000_000 * 0.98) / 240))
  })

  it('assumes 128 kbps for copied audio whose bitrate isn’t known', () => {
    const info = { ...phone(), tracks: [phone().tracks[0], fakeAudioTrack({ bitrate: null })] }
    expect(plan(info, { aim: 'size', targetMB: 50 }).plan?.video?.bitrate).toBe(1_505_333)
  })

  it('refuses a target that leaves too few bits per pixel, suggesting a size that would work', () => {
    // 12 MB over 4 minutes leaves about 0.26 Mbps for the video: under the floor at 1080p (1.24 Mbps)
    // and 720p (0.55), over it at 480p (0.25).
    expect(plan(phone(), { aim: 'size', targetMB: 12 }).problems).toEqual([
      '12 MB is too small for 4 minutes at 1080p. Try 480p or a larger size.',
    ])
  })

  it('suggests the largest size that would work', () => {
    // Without audio, 10 MB over 4 minutes is 0.33 Mbps (enough for 480p) and 20 MB is 0.65 Mbps
    // (enough for 720p, which needs 0.55).
    const info = fakeInfo({ duration: 240, tracks: [fakeVideoTrack({ frameRate: 30 })] })
    expect(plan(info, { aim: 'size', targetMB: 10 }).problems).toEqual([
      '10 MB is too small for 4 minutes at 1080p. Try 480p or a larger size.',
    ])
    expect(plan(info, { aim: 'size', targetMB: 20 }).problems).toEqual([
      '20 MB is too small for 4 minutes at 1080p. Try 720p or a larger size.',
    ])
  })

  it('only suggests a larger size when no smaller resolution would do', () => {
    expect(plan(phone(), { aim: 'size', targetMB: 2 }).problems).toEqual([
      '2 MB is too small for 4 minutes at 1080p. Try a larger size.',
    ])
    expect(plan(phone(), { aim: 'size', targetMB: 12, resolution: '480' }).problems).toBeUndefined()
  })

  it('counts the capped frame rate', () => {
    const fast = fakeInfo({ duration: 240, tracks: [fakeVideoTrack({ frameRate: 60 })] })
    expect(plan(fast, { aim: 'size', targetMB: 40 }).problems).toHaveLength(1)
    expect(plan(fast, { aim: 'size', targetMB: 40, frameRate: '30' }).problems).toBeUndefined()
  })

  it('words short and long durations', () => {
    const short = fakeInfo({ duration: 45, tracks: [fakeVideoTrack()] })
    expect(plan(short, { aim: 'size', targetMB: 1 }).problems?.[0]).toMatch(
      /^1 MB is too small for 45 seconds at 1080p/,
    )
    const long = fakeInfo({ duration: 3900, tracks: [fakeVideoTrack()] })
    expect(plan(long, { aim: 'size', targetMB: 50 }).problems?.[0]).toMatch(/for 1 hour 5 minutes at 1080p/)
    const minute = fakeInfo({ duration: 60.2, tracks: [fakeVideoTrack()] })
    expect(plan(minute, { aim: 'size', targetMB: 1 }).problems?.[0]).toMatch(/for 1 minute at/)
    // Under ten minutes the seconds count: 1:30 isn't "2 minutes".
    const ninety = fakeInfo({ duration: 90, tracks: [fakeVideoTrack()] })
    expect(plan(ninety, { aim: 'size', targetMB: 1 }).problems?.[0]).toMatch(/for 1 minute 30 seconds at/)
    const longer = fakeInfo({ duration: 754, tracks: [fakeVideoTrack()] })
    expect(plan(longer, { aim: 'size', targetMB: 1 }).problems?.[0]).toMatch(/for 13 minutes at/)
  })

  it('notes a target larger than the file', () => {
    const result = plan(fakeInfo({ size: 30_000_000 }), { aim: 'size', targetMB: 50 })
    expect(result.hints).toContain('The file is already smaller than 50 MB.')
  })
})

describe('other tracks and problems', () => {
  it('needs video', () => {
    expect(plan(fakeInfo({ tracks: [fakeAudioTrack()] })).problems).toEqual(['This file has no video.'])
  })

  it('needs video this browser can decode', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] })
    expect(plan(info).problems).toEqual(['This browser can’t decode HEVC video, so it can’t compress it.'])
  })

  it('copies subtitles the container holds and says when it leaves them out', () => {
    const { sampleRate: _r, channels: _c, bitDepth: _b, ...common } = fakeAudioTrack({ id: 3, codec: 'webvtt' })
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack(), { ...common, kind: 'subtitle' }] })
    const mp4 = plan(info)
    const webm = plan(info, { codec: 'vp9' })
    for (const result of [mp4, webm]) {
      const holds = CONTAINER_CODECS[result.plan!.container].includes('webvtt')
      expect(result.plan?.keep.includes(3)).toBe(holds)
      if (!holds) expect(result.hints).toContain('Subtitles aren’t carried over.')
    }
  })

  it('leaves out tracks whose codec Mediabunny can’t name, and says so', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null })] })
    const result = plan(info)
    expect(result.plan?.keep).toEqual([1])
    expect(result.hints).toEqual(['Moviola can’t tell which codec an audio track uses, so it’s left out.'])
  })
})
