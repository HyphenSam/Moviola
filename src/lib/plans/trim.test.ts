import { describe, expect, it } from 'vitest'
import type { Capabilities } from '@/lib/capabilities'
import type { MediaInfo } from '@/lib/info'
import { ALL_CAPABLE, fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { CONTAINER_CODECS } from '@/media/formats'
import { keyframeNote, planTrim, preciseProblem, type TrimMode, type TimeRange } from './trim'

const plan = (
  info: MediaInfo,
  range: TimeRange = { start: 12.5, end: 30 },
  mode: TrimMode = 'fast',
  caps: Capabilities = ALL_CAPABLE,
) => planTrim(info, range, mode, CONTAINER_CODECS, caps)

const noEncoders: Capabilities = { ...ALL_CAPABLE, encodeVideo: {} }

describe('planTrim, Fast', () => {
  it('copies every track from the in point to the out point into the source’s container, losslessly', () => {
    const planned = plan(fakeInfo())
    expect(planned.plan).toEqual({
      kind: 'video',
      container: 'mp4',
      name: 'holiday (trimmed).mp4',
      mimeType: 'video/mp4',
      lossless: true,
      keep: [1, 2],
      trim: { start: 12.5, end: 30 },
    })
    expect(planned.caption).toBe('Every track copied as is. No quality is lost.')
  })

  it('counts from the file’s first timestamp, so a late-starting MPEG-TS is cut where the user sees', () => {
    const info = fakeInfo({ name: 'match.ts', container: 'mpegts', start: 1.4 })
    expect(plan(info).plan).toMatchObject({
      container: 'mpegts',
      name: 'match (trimmed).ts',
      mimeType: 'video/mp2t',
      trim: { start: 13.9, end: 31.4 },
    })
  })

  it('keeps the source’s own extension when the container stays the same', () => {
    expect(plan(fakeInfo({ name: 'clip.m4v' })).plan?.name).toBe('clip (trimmed).m4v')
    expect(plan(fakeInfo({ name: 'match.m2ts', container: 'mpegts' })).plan?.name).toBe('match (trimmed).m2ts')
  })

  it('uses the container’s usual extension when the source’s own is one the save dialog refuses', () => {
    expect(plan(fakeInfo({ name: 'clip.' })).plan?.name).toBe('clip (trimmed).mp4')
    expect(plan(fakeInfo({ name: 'My Video.final cut' })).plan?.name).toBe('My Video (trimmed).mp4')
    // 16 letters: one more than the dialog takes.
    expect(plan(fakeInfo({ name: 'match.transportstreams', container: 'mpegts' })).plan?.name).toBe(
      'match (trimmed).ts',
    )
    expect(plan(fakeAudioInfo({ name: 'song.' })).plan?.name).toBe('song (trimmed).m4a')
  })

  it('names Ogg holding Opus .opus and Ogg holding Vorbis .ogg when the source’s extension can’t be used', () => {
    const ogg = (name: string, codec: 'opus' | 'vorbis') =>
      plan(fakeAudioInfo({ name, container: 'ogg', tracks: [fakeAudioTrack({ codec })] })).plan
    expect(ogg('voice note', 'opus')).toMatchObject({ container: 'ogg', name: 'voice note (trimmed).opus' })
    expect(ogg('voice.', 'opus')?.name).toBe('voice (trimmed).opus')
    expect(ogg('voice note', 'vorbis')?.name).toBe('voice note (trimmed).ogg')
    // An extension that can be used is kept as written, whatever the codec.
    expect(ogg('voice.ogg', 'opus')?.name).toBe('voice (trimmed).ogg')
  })

  it('falls back to MKV when the source’s container can’t hold a track', () => {
    // WebM can't hold AAC; a WebM with AAC in it comes from elsewhere, but it does turn up.
    const info = fakeInfo({
      name: 'odd.webm',
      container: 'webm',
      tracks: [fakeVideoTrack({ codec: 'vp9' }), fakeAudioTrack()],
    })
    expect(plan(info).plan).toMatchObject({
      container: 'mkv',
      name: 'odd (trimmed).mkv',
      mimeType: 'video/x-matroska',
      lossless: true,
    })
  })

  it('keeps subtitles along with the video and audio', () => {
    const info = fakeInfo({
      name: 'film.mkv',
      container: 'mkv',
      tracks: [fakeVideoTrack(), fakeAudioTrack(), { ...fakeAudioTrack({ id: 3 }), kind: 'subtitle', codec: 'webvtt' }],
    })
    expect(plan(info).plan?.keep).toEqual([1, 2, 3])
  })

  it('leaves out a track whose codec Moviola can’t tell, and says so', () => {
    const info = fakeInfo({
      name: 'old.mov',
      container: 'mov',
      tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null, codecString: null })],
    })
    const planned = plan(info)
    expect(planned.plan?.keep).toEqual([1])
    expect(planned.hints).toEqual(['Moviola can’t tell which codec an audio track uses, so it’s left out.'])
  })

  it('calls the cut audio when the video it leaves out was all the video there was', () => {
    const info = fakeInfo({
      name: 'odd.mkv',
      container: 'mkv',
      tracks: [fakeVideoTrack({ codec: null, codecString: null }), fakeAudioTrack()],
    })
    const planned = plan(info)
    expect(planned.plan).toMatchObject({
      kind: 'audio',
      name: 'odd (trimmed).mkv',
      mimeType: 'audio/x-matroska',
      keep: [2],
    })
    expect(planned.hints).toEqual(['Moviola can’t tell which codec a video track uses, so it’s left out.'])
  })

  it('cuts an audio file too, named and typed as audio', () => {
    const planned = plan(fakeAudioInfo())
    expect(planned.plan).toEqual({
      kind: 'audio',
      container: 'mp4',
      name: 'song (trimmed).m4a',
      mimeType: 'audio/mp4',
      lossless: true,
      keep: [1],
      trim: { start: 12.5, end: 30 },
    })
  })

  it('cuts an audio file the same way whatever mode is asked for: Fast is exact enough for audio', () => {
    expect(plan(fakeAudioInfo(), undefined, 'precise')).toEqual(plan(fakeAudioInfo()))
  })
})

describe('planTrim, Precise', () => {
  it('re-encodes the video in its own codec at the source’s bitrate and copies the audio', () => {
    const planned = plan(fakeInfo(), undefined, 'precise')
    expect(planned.plan).toEqual({
      kind: 'video',
      container: 'mp4',
      name: 'holiday (trimmed).mp4',
      mimeType: 'video/mp4',
      lossless: false,
      keep: [1, 2],
      trim: { start: 12.5, end: 30 },
      video: { codec: 'avc', bitrate: 4_000_000 },
    })
    expect(planned.caption).toBe('Video re-encoded, audio copied.')
  })

  it('leaves the bitrate to the encoder when the source’s isn’t known', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ bitrate: null }), fakeAudioTrack()] })
    expect(plan(info, undefined, 'precise').plan?.video).toEqual({ codec: 'avc' })
  })

  it('says only the video is re-encoded when there’s no audio', () => {
    expect(plan(fakeInfo({ tracks: [fakeVideoTrack()] }), undefined, 'precise').caption).toBe('Video re-encoded.')
  })

  it('uses H.264 when the browser can’t encode the source’s codec, and says so', () => {
    const info = fakeInfo({
      name: 'phone.mov',
      container: 'mov',
      tracks: [fakeVideoTrack({ codec: 'hevc' }), fakeAudioTrack()],
    })
    const planned = plan(info, undefined, 'precise', { ...ALL_CAPABLE, encodeVideo: { avc: true, hevc: false } })
    expect(planned.plan).toMatchObject({ container: 'mov', name: 'phone (trimmed).mov', video: { codec: 'avc' } })
    expect(planned.caption).toBe('Video re-encoded to H.264, audio copied.')
  })

  it('writes MP4 when the source’s container can’t hold the H.264 it falls back to', () => {
    const info = fakeInfo({
      name: 'clip.webm',
      container: 'webm',
      tracks: [fakeVideoTrack({ codec: 'vp9' }), fakeAudioTrack({ codec: 'opus' })],
    })
    const planned = plan(info, undefined, 'precise', { ...ALL_CAPABLE, encodeVideo: { avc: true, vp9: false } })
    expect(planned.plan).toMatchObject({
      container: 'mp4',
      name: 'clip (trimmed).mp4',
      mimeType: 'video/mp4',
      video: { codec: 'avc' },
    })
  })

  it('keeps WebM when the browser can encode VP9', () => {
    const info = fakeInfo({
      name: 'clip.webm',
      container: 'webm',
      tracks: [fakeVideoTrack({ codec: 'vp9' }), fakeAudioTrack({ codec: 'opus' })],
    })
    expect(plan(info, undefined, 'precise').plan).toMatchObject({ container: 'webm', video: { codec: 'vp9' } })
  })

  it('can’t run without an encoder for the source’s codec or H.264', () => {
    expect(plan(fakeInfo(), undefined, 'precise', noEncoders)).toEqual({
      problems: ['This browser can’t encode H.264 video, so Precise isn’t available. Fast still works.'],
    })
    const vp9 = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'vp9' })] })
    expect(plan(vp9, undefined, 'precise', noEncoders).problems).toEqual([
      'This browser can’t encode VP9 or H.264 video, so Precise isn’t available. Fast still works.',
    ])
  })

  it('can’t run when the browser can’t decode the video', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] })
    expect(plan(info, undefined, 'precise').problems).toEqual(['This browser can’t decode HEVC. Fast still works.'])
  })
})

describe('preciseProblem', () => {
  it('is null where Precise can run, and the reason where it can’t', () => {
    expect(preciseProblem(fakeInfo(), ALL_CAPABLE)).toBeNull()
    expect(preciseProblem(fakeInfo(), noEncoders)).toBe(
      'This browser can’t encode H.264 video, so Precise isn’t available. Fast still works.',
    )
    expect(preciseProblem(fakeAudioInfo(), noEncoders)).toBeNull()
  })
})

describe('planTrim, problems', () => {
  it('needs the out point after the in point', () => {
    expect(plan(fakeInfo(), { start: 30, end: 30 }).problems).toEqual(['The out point must be after the in point.'])
    expect(plan(fakeInfo(), { start: 30, end: 12 }).problems).toEqual(['The out point must be after the in point.'])
  })

  it('needs at least one frame of video', () => {
    // 25 fps: a frame lasts 0.04 s.
    expect(plan(fakeInfo(), { start: 10, end: 10.03 }).problems).toEqual(['The range must be at least one frame long.'])
    expect(plan(fakeInfo(), { start: 10, end: 10.04 }).plan).toBeDefined()
    expect(plan(fakeAudioInfo(), { start: 10, end: 10.01 }).plan).toBeDefined()
  })
})

describe('keyframeNote', () => {
  it('says where a fast trim really starts when the keyframe is more than a frame before the in point', () => {
    expect(keyframeNote(12.48, 12, 25)).toBe('Starts at 0:12.000, the nearest keyframe, 0.48 s before your in point.')
    expect(keyframeNote(3, 2, 25)).toBe('Starts at 0:02.000, the nearest keyframe, 1.00 s before your in point.')
  })

  it('says nothing when the cut lands within a frame of the in point, or the keyframe isn’t known yet', () => {
    expect(keyframeNote(12.04, 12, 25)).toBeNull()
    expect(keyframeNote(12, 12, 25)).toBeNull()
    expect(keyframeNote(0, 0.02, 25)).toBeNull()
    expect(keyframeNote(12.48, null, 25)).toBeNull()
  })
})
