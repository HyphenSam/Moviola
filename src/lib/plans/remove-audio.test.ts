import { describe, expect, it } from 'vitest'
import type { MediaInfo, SubtitleTrack } from '@/lib/info'
import { fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { CONTAINER_CODECS } from '@/media/formats'
import { planRemoveAudio } from './remove-audio'

const plan = (info: MediaInfo, keepAudio: number[] = []) => planRemoveAudio(info, keepAudio, CONTAINER_CODECS)

const subtitles: SubtitleTrack = {
  kind: 'subtitle',
  id: 4,
  codec: 'webvtt',
  codecString: null,
  language: 'eng',
  name: null,
  isDefault: false,
  bitrate: null,
  canDecode: true,
}

const twoAudio = (over: Partial<MediaInfo> = {}) =>
  fakeInfo({
    name: 'film.mkv',
    container: 'mkv',
    tracks: [
      fakeVideoTrack(),
      fakeAudioTrack({ language: 'eng' }),
      fakeAudioTrack({ id: 3, language: 'fra', channels: 6 }),
    ],
    ...over,
  })

describe('planRemoveAudio', () => {
  it('copies the video without its audio into the source’s container, losslessly', () => {
    const planned = plan(fakeInfo())
    expect(planned.plan).toEqual({
      kind: 'video',
      container: 'mp4',
      name: 'holiday (no audio).mp4',
      mimeType: 'video/mp4',
      lossless: true,
      keep: [1],
    })
    expect(planned.caption).toBe('Video copied as is, without its audio. No quality is lost.')
  })

  it('removes every audio track by default', () => {
    expect(plan(twoAudio()).plan).toMatchObject({ keep: [1], name: 'film (no audio).mkv' })
  })

  it('keeps the audio tracks the user ticks, and says it was edited rather than silenced', () => {
    const planned = plan(twoAudio(), [3])
    expect(planned.plan).toMatchObject({ keep: [1, 3], name: 'film (edited).mkv' })
    expect(planned.caption).toBe('Video and the ticked audio copied as is. No quality is lost.')
  })

  it('keeps subtitles', () => {
    const info = twoAudio({ tracks: [...twoAudio().tracks, subtitles] })
    expect(plan(info).plan?.keep).toEqual([1, 4])
  })

  it('keeps the source’s own extension', () => {
    expect(plan(fakeInfo({ name: 'clip.m4v' })).plan?.name).toBe('clip (no audio).m4v')
    expect(plan(fakeInfo({ name: 'match.m2ts', container: 'mpegts' })).plan).toMatchObject({
      container: 'mpegts',
      name: 'match (no audio).m2ts',
    })
  })

  it('falls back to MKV when the source’s container can’t hold what’s kept', () => {
    // A WebM with H.264 in it comes from elsewhere, but it does turn up.
    const info = fakeInfo({ name: 'odd.webm', container: 'webm' })
    expect(plan(info).plan).toMatchObject({ container: 'mkv', name: 'odd (no audio).mkv' })
  })

  it('leaves out a track whose codec Moviola can’t tell, and says so', () => {
    const info = twoAudio({ tracks: [...twoAudio().tracks, { ...subtitles, codec: null }] })
    const planned = plan(info)
    expect(planned.plan?.keep).toEqual([1])
    expect(planned.hints).toEqual(['Moviola can’t tell which codec a subtitle track uses, so it’s left out.'])
  })

  it('has nothing to remove when every audio track is kept, or when there’s none', () => {
    expect(plan(twoAudio(), [2, 3]).problems).toEqual(['Every audio track is ticked, so nothing would be removed.'])
    expect(plan(fakeInfo({ tracks: [fakeVideoTrack()] })).problems).toEqual(['This file has no audio track.'])
  })

  it('needs video', () => {
    expect(plan(fakeAudioInfo()).problems).toEqual(['This file has no video.'])
    const unknown = fakeInfo({ container: 'mov', tracks: [fakeVideoTrack({ codec: null }), fakeAudioTrack()] })
    expect(plan(unknown).problems).toEqual(['Moviola can’t tell which codec this video uses, so it can’t copy it.'])
  })
})
