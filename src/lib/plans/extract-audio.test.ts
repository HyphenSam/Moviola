import { describe, expect, it } from 'vitest'
import { fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { CONTAINER_CODECS } from '@/media/formats'
import { audioTrackLabel, defaultAudioTrack, planExtractAudio } from './extract-audio'

const twoTracks = fakeInfo({
  name: 'film.mkv',
  container: 'mkv',
  tracks: [
    fakeVideoTrack(),
    fakeAudioTrack({ id: 2, language: 'eng', isDefault: false }),
    fakeAudioTrack({ id: 3, language: 'fra', codec: 'ac3', codecString: 'ac-3', channels: 6, isDefault: true }),
  ],
})

describe('defaultAudioTrack', () => {
  it('picks the default audio track, else the first', () => {
    expect(defaultAudioTrack(twoTracks)?.id).toBe(3)
    expect(defaultAudioTrack(fakeInfo({ tracks: [fakeAudioTrack({ id: 4, isDefault: false })] }))?.id).toBe(4)
    expect(defaultAudioTrack(fakeInfo({ tracks: [fakeVideoTrack()] }))).toBeNull()
  })
})

describe('audioTrackLabel', () => {
  it('names the language, codec and channels', () => {
    expect(audioTrackLabel(twoTracks.tracks[2] as never, 2)).toBe('French · AC-3 · 5.1')
  })

  it('falls back to the track’s number and adds its name', () => {
    expect(audioTrackLabel(fakeAudioTrack({ name: 'Commentary' }), 1)).toBe('Track 1 · Commentary · AAC · stereo')
  })
})

describe('planExtractAudio, Original', () => {
  it('copies the AAC track of an MP4 into .m4a, keeping nothing else', () => {
    const result = planExtractAudio(fakeInfo(), { trackId: null }, CONTAINER_CODECS)
    expect(result).toEqual({
      plan: {
        kind: 'audio',
        container: 'mp4',
        name: 'holiday.m4a',
        mimeType: 'audio/mp4',
        lossless: true,
        keep: [2],
      },
      caption: 'AAC, copied as is into .m4a. No quality is lost.',
    })
  })

  it('copies the chosen track and names it when it isn’t the first audio track', () => {
    const result = planExtractAudio(twoTracks, { trackId: 3 }, CONTAINER_CODECS)
    expect(result.plan).toMatchObject({ container: 'mkv', name: 'film (track 2).mka', keep: [3] })
    expect(result.caption).toBe('AC-3, copied as is into .mka. No quality is lost.')
    expect(planExtractAudio(twoTracks, { trackId: 2 }, CONTAINER_CODECS).plan?.name).toBe('film.m4a')
  })

  it('uses the default track when none is chosen', () => {
    expect(planExtractAudio(twoTracks, { trackId: null }, CONTAINER_CODECS).plan?.keep).toEqual([3])
  })

  it('converts an audio-only file’s track all the same', () => {
    expect(planExtractAudio(fakeAudioInfo(), { trackId: null }, CONTAINER_CODECS).plan).toMatchObject({
      name: 'song.m4a',
      keep: [1],
    })
  })

  it('says so when there’s no audio', () => {
    expect(planExtractAudio(fakeInfo({ tracks: [fakeVideoTrack()] }), { trackId: null }, CONTAINER_CODECS)).toEqual({
      problems: ['This file has no audio track.'],
    })
  })

  it('can’t copy a track whose codec Moviola can’t tell', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null, codecString: null })] })
    expect(planExtractAudio(info, { trackId: null }, CONTAINER_CODECS)).toEqual({
      problems: ['Moviola can’t tell which codec this audio track uses, so it can’t copy it.'],
    })
  })

  it('names the codec when no container can hold it', () => {
    const none = { ...CONTAINER_CODECS, ogg: [], mkv: [], mov: [] }
    const info = fakeInfo({ tracks: [fakeAudioTrack({ codec: 'opus', codecString: 'opus' })] })
    expect(planExtractAudio(info, { trackId: null }, none)).toEqual({
      problems: ['Moviola can’t write Opus audio into any file type it knows.'],
    })
  })
})
