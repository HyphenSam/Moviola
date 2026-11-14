import { describe, expect, it } from 'vitest'
import type { MediaInfo, SubtitleTrack } from '@/lib/info'
import { fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { CONTAINER_CODECS } from '@/media/formats'
import {
  containerTracks,
  defaultContainer,
  planChangeContainer,
  subtitleNote,
  type ContainerChoice,
} from './change-container'

const plan = (info: MediaInfo, container: ContainerChoice, dropped: number[] = []) =>
  planChangeContainer(info, container, dropped, CONTAINER_CODECS)

const subtitles = (over: Partial<SubtitleTrack> = {}): SubtitleTrack => ({
  kind: 'subtitle',
  id: 4,
  codec: 'webvtt',
  codecString: null,
  language: 'eng',
  name: null,
  isDefault: false,
  bitrate: null,
  canDecode: true,
  ...over,
})

const webm = (over: Partial<MediaInfo> = {}) =>
  fakeInfo({
    name: 'talk.webm',
    container: 'webm',
    tracks: [fakeVideoTrack({ codec: 'vp9' }), fakeAudioTrack({ codec: 'opus' })],
    ...over,
  })

const ac3 = () =>
  fakeInfo({
    name: 'film.mkv',
    container: 'mkv',
    tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', channels: 6, canDecode: false })],
  })

describe('defaultContainer', () => {
  it('is MP4, the one that plays everywhere, or MKV for a file that’s already MP4', () => {
    expect(defaultContainer(webm())).toBe('mp4')
    expect(defaultContainer(ac3())).toBe('mp4')
    expect(defaultContainer(fakeInfo())).toBe('mkv')
  })
})

describe('containerTracks', () => {
  it('lists every track with what it is, and nothing against the ones the container holds', () => {
    const info = fakeInfo({
      tracks: [fakeVideoTrack(), fakeAudioTrack({ language: 'fra', name: 'Commentary' })],
    })
    expect(containerTracks(info, 'mkv', CONTAINER_CODECS)).toEqual([
      { track: info.tracks[0], label: 'Video · H.264', reason: null },
      { track: info.tracks[1], label: 'Audio · AAC · French · Commentary', reason: null },
    ])
  })

  it('says why a track can’t go into the chosen container, naming its codec', () => {
    const rows = containerTracks(ac3(), 'webm', CONTAINER_CODECS)
    expect(rows.map((r) => r.reason)).toEqual(['WebM can’t hold H.264.', 'WebM can’t hold AC-3.'])
    expect(
      containerTracks(fakeInfo({ tracks: [fakeVideoTrack(), subtitles()] }), 'mov', CONTAINER_CODECS)[1].reason,
    ).toBe('MOV can’t hold WebVTT.')
  })

  it('says when Moviola can’t tell a track’s codec, so it can’t be copied', () => {
    const info = fakeInfo({ container: 'mov', tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null })] })
    expect(containerTracks(info, 'mkv', CONTAINER_CODECS)[1].reason).toBe(
      'Moviola can’t tell which codec this track uses.',
    )
  })
})

describe('subtitleNote', () => {
  it('warns once, for MKV sources, that subtitles other than WebVTT aren’t carried over', () => {
    expect(subtitleNote(ac3())).toBe('Subtitles other than WebVTT aren’t carried over.')
    expect(subtitleNote(fakeInfo())).toBeNull()
    expect(subtitleNote(webm())).toBeNull()
  })
})

describe('planChangeContainer', () => {
  it('copies every track as is into the chosen container, losslessly, named after the source', () => {
    const planned = plan(webm(), 'mp4')
    expect(planned.plan).toEqual({
      kind: 'video',
      container: 'mp4',
      name: 'talk.mp4',
      mimeType: 'video/mp4',
      lossless: true,
      keep: [1, 2],
    })
    expect(planned.caption).toBe('Every ticked track copied as is. No quality is lost.')
  })

  it.each([
    ['mov', 'holiday.mov', 'video/quicktime'],
    ['mkv', 'holiday.mkv', 'video/x-matroska'],
  ] as const)('writes %s as %s', (container, name, mimeType) => {
    expect(plan(fakeInfo(), container).plan).toMatchObject({ container, name, mimeType })
  })

  it('leaves out the tracks the user unticked', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack(), fakeAudioTrack({ id: 3 })] })
    expect(plan(info, 'mkv', [2]).plan?.keep).toEqual([1, 3])
  })

  it('leaves out the tracks the container can’t hold, keeping the video', () => {
    const info = webm({ tracks: [fakeVideoTrack({ codec: 'vp9' }), fakeAudioTrack({ codec: 'aac' })] })
    expect(plan(info, 'webm', []).problems).toEqual(['It’s already WebM.'])
    const mkv = { ...info, container: 'mkv' as const }
    expect(plan(mkv, 'webm').plan?.keep).toEqual([1])
  })

  it('leaves out a track whose codec Moviola can’t tell', () => {
    const info = fakeInfo({ container: 'mov', tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null })] })
    expect(plan(info, 'mkv').plan?.keep).toEqual([1])
  })

  it('refuses, naming the real codecs and the way out, when the video can’t go into the container', () => {
    expect(plan(ac3(), 'webm').problems).toEqual([
      'WebM can’t hold this video’s H.264. Use Compress to convert it to VP9 or AV1.',
    ])
    const hevc = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc' }), fakeAudioTrack({ codec: 'opus' })] })
    expect(plan(hevc, 'webm').problems).toEqual([
      'WebM can’t hold this video’s HEVC. Use Compress to convert it to VP9 or AV1.',
    ])
  })

  it('refuses a video whose codec Moviola can’t tell', () => {
    const info = fakeInfo({ container: 'mov', tracks: [fakeVideoTrack({ codec: null }), fakeAudioTrack()] })
    expect(plan(info, 'mkv').problems).toEqual(['Moviola can’t tell which codec this video uses, so it can’t copy it.'])
  })

  it('writes the audio on its own when the user unticks the video', () => {
    expect(plan(webm(), 'mp4', [1]).plan).toMatchObject({
      kind: 'audio',
      name: 'talk.m4a',
      mimeType: 'audio/mp4',
      keep: [2],
    })
  })

  it('needs at least one track ticked', () => {
    expect(plan(fakeInfo(), 'mkv', [1, 2]).problems).toEqual(['Tick at least one track to keep.'])
  })

  it('has nothing to do for the source’s own container, or for a file with no video', () => {
    expect(plan(fakeInfo(), 'mp4').problems).toEqual(['It’s already MP4.'])
    expect(plan(fakeAudioInfo(), 'mkv').problems).toEqual(['This file has no video.'])
  })
})
