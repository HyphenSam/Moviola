import { describe, expect, it } from 'vitest'
import type { Plan } from './plan'
import { planProblems } from './plan-problems'
import { fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from './testing'

// holiday.mp4: H.264 video (1) and AAC audio (2).
const info = fakeInfo()
const copy = (over: Partial<Plan> = {}): Plan => ({
  kind: 'video',
  container: 'mkv',
  name: 'holiday.mkv',
  mimeType: 'video/x-matroska',
  lossless: true,
  keep: [1, 2],
  ...over,
})
const compress = (over: Partial<Plan> = {}): Plan => ({
  kind: 'video',
  container: 'mp4',
  name: 'holiday (compressed).mp4',
  mimeType: 'video/mp4',
  lossless: false,
  keep: [1, 2],
  video: { codec: 'avc', bitrate: 2_000_000, width: 1280, height: 720 },
  ...over,
})
const toWav = (over: Partial<Plan> = {}): Plan => ({
  kind: 'audio',
  container: 'wav',
  name: 'holiday.wav',
  mimeType: 'audio/wav',
  lossless: false,
  keep: [2],
  audio: { codec: 'pcm-s16' },
  ...over,
})

describe('planProblems', () => {
  it('finds nothing wrong with a copy, a re-encode or a conversion of the audio', () => {
    expect(planProblems(copy(), info)).toEqual([])
    expect(planProblems(compress(), info)).toEqual([])
    expect(planProblems(toWav(), info)).toEqual([])
  })

  it('lets audio conversions be lossless or not, as PCM to a deep enough WAV is', () => {
    expect(planProblems(toWav({ lossless: true }), info)).toEqual([])
  })

  it('refuses a lossless re-encode of the video', () => {
    expect(planProblems(compress({ lossless: true }), info)).toEqual([
      'It says no quality is lost, but it re-encodes the video.',
    ])
  })

  it('refuses a copy that doesn’t say it’s lossless', () => {
    expect(planProblems(copy({ lossless: false }), info)).toEqual([
      'It copies every track, but doesn’t say no quality is lost.',
    ])
  })

  it('refuses a plan that keeps nothing, or a track the file doesn’t have', () => {
    expect(planProblems(copy({ keep: [] }), info)).toContain('It keeps no tracks.')
    expect(planProblems(copy({ keep: [1, 2, 7] }), info)).toEqual(['It keeps track 7, which isn’t in the file.'])
  })

  it('refuses to re-encode video or audio it doesn’t keep', () => {
    expect(
      planProblems(compress({ keep: [2], kind: 'audio', name: 'holiday.m4a', mimeType: 'audio/mp4' }), info),
    ).toContain('It re-encodes video, but keeps no video track.')
    expect(
      planProblems(
        toWav({ keep: [1], kind: 'video', container: 'mkv', name: 'holiday.mkv', mimeType: 'video/x-matroska' }),
        info,
      ),
    ).toContain('It re-encodes audio, but keeps no audio track.')
  })

  it('is a video exactly when it keeps a video track', () => {
    expect(planProblems(copy({ kind: 'audio', name: 'holiday.mka', mimeType: 'audio/x-matroska' }), info)).toEqual([
      'It keeps a video track, but says it’s audio.',
    ])
    expect(planProblems(copy({ keep: [2] }), info)).toEqual(['It keeps no video track, but says it’s video.'])
  })

  it('names the file with the extension and type of its container and kind', () => {
    expect(planProblems(copy({ name: 'holiday.mp4' }), info)).toEqual(['Its name, holiday.mp4, should end in .mkv.'])
    expect(planProblems(copy({ mimeType: 'video/mp4' }), info)).toEqual([
      'Its type, video/mp4, should be video/x-matroska.',
    ])
    expect(planProblems(copy({ name: 'holiday' }), info)).toEqual(['Its name, holiday, should end in .mkv.'])
  })

  it('names audio on its own as audio: .m4a in MP4, .mka in Matroska', () => {
    // From an MKV, so the source's own extension doesn't come into it.
    const mkv = fakeInfo({ name: 'holiday.mkv', container: 'mkv' })
    const audioOnly = (container: Plan['container'], name: string, mimeType: string) =>
      planProblems(copy({ kind: 'audio', keep: [2], container, name, mimeType }), mkv)
    expect(audioOnly('mp4', 'holiday.m4a', 'audio/mp4')).toEqual([])
    expect(audioOnly('mkv', 'holiday.mka', 'audio/x-matroska')).toEqual([])
    expect(audioOnly('mp4', 'holiday.mp4', 'video/mp4')).toEqual([
      'Its name, holiday.mp4, should end in .m4a.',
      'Its type, video/mp4, should be audio/mp4.',
    ])
  })

  it('names Ogg after what it holds: .opus for Opus, .ogg for Vorbis', () => {
    const opus = fakeAudioInfo({
      name: 'song.webm',
      container: 'webm',
      tracks: [fakeAudioTrack({ id: 1, codec: 'opus' })],
    })
    const ogg = (name: string) =>
      planProblems(copy({ kind: 'audio', keep: [1], container: 'ogg', name, mimeType: 'audio/ogg' }), opus)
    expect(ogg('song.opus')).toEqual([])
    expect(ogg('song.ogg')).toEqual(['Its name, song.ogg, should end in .opus.'])
    const vorbis = { ...opus, tracks: [fakeAudioTrack({ id: 1, codec: 'vorbis' })] }
    expect(
      planProblems(
        copy({ kind: 'audio', keep: [1], container: 'ogg', name: 'song.ogg', mimeType: 'audio/ogg' }),
        vorbis,
      ),
    ).toEqual([])
  })

  it('lets a file in its own container keep its own extension', () => {
    const m4v = fakeInfo({ name: 'holiday.M4V' })
    const own = copy({ container: 'mp4', name: 'holiday (no audio).M4V', mimeType: 'video/mp4', keep: [1] })
    expect(planProblems(own, m4v)).toEqual([])
    expect(planProblems({ ...own, container: 'mkv', mimeType: 'video/x-matroska' }, m4v)).toEqual([
      'Its name, holiday (no audio).M4V, should end in .mkv.',
    ])
  })

  it('gives the video’s width and height together, even for H.264 and HEVC', () => {
    const sized = (codec: 'avc' | 'hevc' | 'vp9', width?: number, height?: number) =>
      planProblems(compress({ video: { codec, width, height } }), info)
    expect(sized('avc', 1280)).toEqual(['It gives the video’s width or height without the other.'])
    expect(sized('avc', undefined, 720)).toEqual(['It gives the video’s width or height without the other.'])
    expect(sized('avc')).toEqual([])
    expect(sized('avc', 1279, 720)).toEqual(['H.264 needs an even width and height, not 1279 × 720.'])
    expect(sized('hevc', 1280, 719)).toEqual(['HEVC needs an even width and height, not 1280 × 719.'])
    expect(sized('vp9', 1279, 719)).toEqual([])
  })

  it('holds the bitrate constant only when it gives one', () => {
    expect(planProblems(compress({ video: { codec: 'avc', constantBitrate: true } }), info)).toEqual([
      'It holds the bitrate constant without giving one.',
    ])
  })

  it('cuts only a range that ends after it starts', () => {
    expect(planProblems(copy({ trim: { start: 2, end: 5 } }), info)).toEqual([])
    expect(planProblems(copy({ trim: { start: 5, end: 5 } }), info)).toEqual(['Its cut doesn’t end after it starts.'])
    expect(planProblems(copy({ trim: { start: 5, end: 2 } }), info)).toEqual(['Its cut doesn’t end after it starts.'])
  })

  it('needs only the file’s name, container and tracks', () => {
    const source = { name: 'clip.mov', container: 'mov' as const, tracks: [fakeVideoTrack({ id: 1 })] }
    expect(
      planProblems(copy({ keep: [1], container: 'mov', name: 'clip.mov', mimeType: 'video/quicktime' }), source),
    ).toEqual([])
  })
})
