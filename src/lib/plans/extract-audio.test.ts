import { describe, expect, it } from 'vitest'
import type { Capabilities } from '@/lib/capabilities'
import type { ContainerCodecs } from '@/lib/containers'
import type { MediaInfo } from '@/lib/info'
import { ALL_CAPABLE, fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { CONTAINER_CODECS } from '@/media/formats'
import {
  audioTrackLabel,
  DEFAULT_EXTRACT_AUDIO,
  defaultAudioTrack,
  formatProblems,
  planExtractAudio,
  type ExtractAudioSettings,
} from './extract-audio'

/** Plans with the defaults (Original, the default track) unless told otherwise, in a browser that
 * can encode everything. */
const plan = (
  info: MediaInfo,
  over: Partial<ExtractAudioSettings> = {},
  caps: Capabilities = ALL_CAPABLE,
  codecs: ContainerCodecs = CONTAINER_CODECS,
) => planExtractAudio(info, { ...DEFAULT_EXTRACT_AUDIO, ...over }, codecs, caps)

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
    expect(plan(fakeInfo())).toEqual({
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
    const result = plan(twoTracks, { trackId: 3 })
    expect(result.plan).toMatchObject({ container: 'mkv', name: 'film (track 2).mka', keep: [3] })
    expect(result.caption).toBe('AC-3, copied as is into .mka. No quality is lost.')
    expect(plan(twoTracks, { trackId: 2 }).plan?.name).toBe('film.m4a')
  })

  it('uses the default track when none is chosen', () => {
    expect(plan(twoTracks).plan?.keep).toEqual([3])
  })

  it('converts an audio-only file’s track all the same', () => {
    expect(plan(fakeAudioInfo()).plan).toMatchObject({ name: 'song.m4a', keep: [1] })
  })

  it('says so when there’s no audio', () => {
    expect(plan(fakeInfo({ tracks: [fakeVideoTrack()] }))).toEqual({ problems: ['This file has no audio track.'] })
  })

  it('can’t copy a track whose codec Moviola can’t tell', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null, codecString: null })] })
    expect(plan(info)).toEqual({
      problems: ['Moviola can’t tell which codec this audio track uses, so it can’t copy it.'],
    })
  })

  it('names the codec when no container can hold it', () => {
    const none = { ...CONTAINER_CODECS, ogg: [], mkv: [], mov: [] }
    const info = fakeInfo({ tracks: [fakeAudioTrack({ codec: 'opus', codecString: 'opus' })] })
    expect(plan(info, {}, ALL_CAPABLE, none)).toEqual({
      problems: ['Moviola can’t write Opus audio into any file type it knows.'],
    })
  })
})

const pcm = fakeInfo({
  name: 'take.mov',
  container: 'mov',
  tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'pcm-s16', codecString: 'pcm-s16' })],
})
const flac = fakeAudioInfo({ name: 'a.flac', tracks: [fakeAudioTrack({ id: 1, codec: 'flac', codecString: 'flac' })] })
// The h264-ac3.mkv fixture's info, as a browser sees it: no browser decodes AC-3.
const ac3 = fakeInfo({
  name: 'h264-ac3.mkv',
  container: 'mkv',
  tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', codecString: 'ac-3', channels: 6, canDecode: false })],
})
const noAddOns: Capabilities = { ...ALL_CAPABLE, encodeAudio: { aac: true, opus: true, mp3: false, flac: false } }

describe('planExtractAudio, MP3', () => {
  it('re-encodes to MP3 at 192 kbps by default', () => {
    expect(plan(fakeInfo(), { format: 'mp3' })).toEqual({
      plan: {
        kind: 'audio',
        container: 'mp3',
        name: 'holiday.mp3',
        mimeType: 'audio/mpeg',
        lossless: false,
        keep: [2],
        audio: { codec: 'mp3', bitrate: 192_000, numberOfChannels: 2 },
      },
      caption: 'AAC re-encoded to MP3 at 192 kbps.',
    })
  })

  it.each([128, 256, 320] as const)('at %i kbps', (kbps) => {
    const result = plan(fakeInfo(), { format: 'mp3', mp3Bitrate: kbps })
    expect(result.plan?.audio).toMatchObject({ bitrate: kbps * 1000 })
    expect(result.caption).toBe(`AAC re-encoded to MP3 at ${kbps} kbps.`)
  })

  it('mixes more than two channels down to stereo, which is all MP3 holds', () => {
    const surround = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ channels: 6 })] })
    expect(plan(surround, { format: 'mp3' }).plan?.audio?.numberOfChannels).toBe(2)
    const mono = fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ channels: 1 })] })
    expect(plan(mono, { format: 'mp3' }).plan?.audio?.numberOfChannels).toBe(1)
  })

  it('resamples rates MP3 can’t hold at full bitrate to 44.1 or 48 kHz, and says so', () => {
    const at = (sampleRate: number) =>
      plan(fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ sampleRate })] }), { format: 'mp3' })
    for (const rate of [32000, 44100, 48000]) expect(at(rate).plan?.audio?.sampleRate).toBeUndefined()
    expect(at(16000).plan?.audio?.sampleRate).toBe(48000)
    expect(at(22050).plan?.audio?.sampleRate).toBe(44100)
    expect(at(88200).plan?.audio?.sampleRate).toBe(44100)
    expect(at(96000).plan?.audio?.sampleRate).toBe(48000)
    expect(at(16000).caption).toBe('AAC re-encoded to MP3 at 192 kbps, resampled to 48 kHz.')
  })

  it('hints that Original keeps an MP3 source without loss', () => {
    const mp3 = fakeAudioInfo({
      name: 'song.mp3',
      tracks: [fakeAudioTrack({ id: 1, codec: 'mp3', codecString: 'mp3' })],
    })
    expect(plan(mp3, { format: 'mp3' }).hints).toEqual(['Already MP3: Original keeps it without loss.'])
    expect(plan(mp3).hints).toBeUndefined()
    expect(plan(fakeInfo(), { format: 'mp3' }).hints).toBeUndefined()
  })

  it('can’t run where there’s no MP3 encoder', () => {
    expect(plan(fakeInfo(), { format: 'mp3' }, noAddOns)).toEqual({ problems: ['This browser can’t encode MP3.'] })
  })

  it('names the second audio track’s result after it', () => {
    const film = fakeInfo({
      name: 'film.mkv',
      tracks: [fakeVideoTrack(), fakeAudioTrack({ id: 2 }), fakeAudioTrack({ id: 3, isDefault: false })],
    })
    expect(plan(film, { format: 'mp3', trackId: 3 }).plan).toMatchObject({ name: 'film (track 2).mp3', keep: [3] })
  })
})

describe('planExtractAudio, WAV', () => {
  it('decodes to 16-bit WAV by default, keeping the source’s rate and channels', () => {
    expect(plan(fakeInfo(), { format: 'wav' })).toEqual({
      plan: {
        kind: 'audio',
        container: 'wav',
        name: 'holiday.wav',
        mimeType: 'audio/wav',
        lossless: false,
        keep: [2],
        audio: { codec: 'pcm-s16' },
      },
      caption: 'WAV is uncompressed, but it can’t restore what the original codec already lost.',
      badge: 'Decodes to WAV',
    })
  })

  it('writes 24-bit PCM when asked', () => {
    expect(plan(fakeInfo(), { format: 'wav', wavBits: 24 }).plan?.audio).toEqual({ codec: 'pcm-s24' })
  })

  it('is lossless from PCM or FLAC', () => {
    const fromPcm = plan(pcm, { format: 'wav' })
    expect(fromPcm).toMatchObject({
      plan: { lossless: true, name: 'take.wav' },
      caption: 'PCM 16-bit, decoded to 16-bit WAV. No quality is lost.',
    })
    expect(fromPcm.badge).toBeUndefined()
    expect(plan(flac, { format: 'wav', wavBits: 24 })).toMatchObject({
      plan: { lossless: true, audio: { codec: 'pcm-s24' } },
      caption: 'FLAC, decoded to 24-bit WAV. No quality is lost.',
    })
  })
})

describe('planExtractAudio, FLAC', () => {
  it('compresses PCM losslessly', () => {
    expect(plan(pcm, { format: 'flac' })).toEqual({
      plan: {
        kind: 'audio',
        container: 'flac',
        name: 'take.flac',
        mimeType: 'audio/flac',
        lossless: true,
        keep: [2],
        audio: { codec: 'flac' },
      },
      caption: 'PCM 16-bit, compressed into FLAC. No quality is lost.',
    })
  })

  it('says what it can’t restore from a lossy source', () => {
    expect(plan(fakeInfo(), { format: 'flac' })).toMatchObject({
      plan: { lossless: false, name: 'holiday.flac' },
      caption: 'FLAC is lossless, but it can’t restore what the original codec already lost.',
      badge: 'Decodes to FLAC',
    })
  })

  it('can’t run where there’s no FLAC encoder', () => {
    expect(plan(pcm, { format: 'flac' }, noAddOns)).toEqual({ problems: ['This browser can’t encode FLAC.'] })
  })
})

describe('a track the browser can’t decode', () => {
  it('still copies as Original', () => {
    expect(plan(ac3).plan).toMatchObject({ name: 'h264-ac3.mka', lossless: true })
  })

  it.each(['mp3', 'wav', 'flac'] as const)('can’t be converted to %s', (format) => {
    expect(plan(ac3, { format })).toEqual({ problems: ['This browser can’t decode AC-3. Original still works.'] })
  })
})

describe('formatProblems', () => {
  it('has none when the track decodes and every encoder is there', () => {
    expect(formatProblems(fakeInfo(), null, ALL_CAPABLE)).toEqual({ original: null, mp3: null, wav: null, flac: null })
  })

  it('rules out every conversion of a track that can’t be decoded', () => {
    const reason = 'This browser can’t decode AC-3. Original still works.'
    expect(formatProblems(ac3, null, ALL_CAPABLE)).toEqual({ original: null, mp3: reason, wav: reason, flac: reason })
  })

  it('rules out MP3 and FLAC without their encoders; WAV needs none', () => {
    expect(formatProblems(fakeInfo(), null, noAddOns)).toEqual({
      original: null,
      mp3: 'This browser can’t encode MP3.',
      wav: null,
      flac: 'This browser can’t encode FLAC.',
    })
  })

  it('looks at the chosen track', () => {
    const mixed = fakeInfo({
      tracks: [fakeVideoTrack(), fakeAudioTrack({ id: 2 }), fakeAudioTrack({ id: 3, codec: 'ac3', canDecode: false })],
    })
    expect(formatProblems(mixed, 2, ALL_CAPABLE).wav).toBeNull()
    expect(formatProblems(mixed, 3, ALL_CAPABLE).wav).toBe('This browser can’t decode AC-3. Original still works.')
  })
})
