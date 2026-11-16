import { describe, expect, it } from 'vitest'
import { CONTAINER_CODECS } from '@/media/formats'
import type { Capabilities } from '../capabilities'
import type { MediaInfo } from '../info'
import type { Planned } from '../plan'
import { planProblems } from '../plan-problems'
import { ALL_CAPABLE, fakeAudioInfo, fakeAudioTrack, fakeInfo, fakeVideoTrack } from '../testing'
import { CONTAINER_CHOICES, planChangeContainer } from './change-container'
import { DEFAULT_COMPRESS, planCompress, type CompressSettings } from './compress'
import { planExtractAudio, type AudioFormat } from './extract-audio'
import { planRemoveAudio } from './remove-audio'
import { planTrim } from './trim'

// A spread of files: the usual, the awkward and the half-understood.
const INFOS: MediaInfo[] = [
  fakeInfo(),
  fakeInfo({ name: 'clip.M4V' }),
  fakeInfo({ name: 'no extension' }),
  fakeInfo({ name: 'My Video.final cut' }),
  fakeInfo({ name: 'quiet.mp4', tracks: [fakeVideoTrack()] }),
  fakeInfo({
    name: 'film.mkv',
    container: 'mkv',
    tracks: [
      fakeVideoTrack({ codec: 'hevc', width: 3840, height: 1606 }),
      fakeAudioTrack({ id: 2, codec: 'ac3', channels: 6, canDecode: false, language: 'fre' }),
      fakeAudioTrack({ id: 3, codec: 'aac', channels: 8 }),
      {
        kind: 'subtitle',
        id: 4,
        codec: 'webvtt',
        codecString: null,
        language: 'eng',
        name: null,
        isDefault: false,
        bitrate: null,
        canDecode: false,
      },
    ],
  }),
  fakeInfo({
    name: 'web.webm',
    container: 'webm',
    tracks: [fakeVideoTrack({ codec: 'vp9', width: 1279, height: 719 }), fakeAudioTrack({ codec: 'opus' })],
  }),
  fakeInfo({
    name: 'camera.mov',
    container: 'mov',
    tracks: [
      fakeVideoTrack({ width: 1080, height: 1920, rotation: 90, frameRate: 59.94 }),
      fakeAudioTrack({ codec: 'pcm-s24', bitDepth: 24 }),
    ],
  }),
  fakeInfo({ name: 'broadcast.ts', container: 'mpegts', start: 1.4 }),
  fakeInfo({
    name: 'odd.mkv',
    container: 'mkv',
    tracks: [fakeVideoTrack({ codec: null, canDecode: false }), fakeAudioTrack()],
  }),
  fakeInfo({ name: 'odd.mp4', tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null, canDecode: false })] }),
  fakeInfo({ name: 'old.mp4', tracks: [fakeVideoTrack({ canDecode: false }), fakeAudioTrack()] }),
  fakeInfo({ name: 'tiny.mp4', tracks: [fakeVideoTrack({ width: 320, height: 180, bitrate: null, frameRate: null })] }),
  fakeAudioInfo(),
  fakeAudioInfo({ name: 'song.mp4' }),
  fakeAudioInfo({
    name: 'surround.wav',
    container: 'wav',
    tracks: [fakeAudioTrack({ id: 1, codec: 'pcm-s16', channels: 8, bitDepth: 16 })],
  }),
  fakeAudioInfo({
    name: 'float.wav',
    container: 'wav',
    tracks: [fakeAudioTrack({ id: 1, codec: 'pcm-f32', bitDepth: 32 })],
  }),
  fakeAudioInfo({
    name: 'hi-res.flac',
    container: 'flac',
    tracks: [fakeAudioTrack({ id: 1, codec: 'flac', bitDepth: 24, sampleRate: 96000 })],
  }),
  fakeAudioInfo({ name: 'voice.ogg', container: 'ogg', tracks: [fakeAudioTrack({ id: 1, codec: 'opus' })] }),
  fakeAudioInfo({
    name: 'old.ogg',
    container: 'ogg',
    tracks: [fakeAudioTrack({ id: 1, codec: 'vorbis', sampleRate: 22050 })],
  }),
  fakeAudioInfo({ name: 'podcast.mp3', container: 'mp3', tracks: [fakeAudioTrack({ id: 1, codec: 'mp3' })] }),
  fakeAudioInfo({
    name: 'mystery.mka',
    container: 'mkv',
    tracks: [fakeAudioTrack({ id: 1, codec: null, canDecode: false })],
  }),
]

const CAPS: Capabilities[] = [
  ALL_CAPABLE,
  { ...ALL_CAPABLE, encodeVideo: {}, encodeAudio: {} },
  { ...ALL_CAPABLE, encodeVideo: { avc: true }, encodeAudio: { aac: true } },
  { ...ALL_CAPABLE, encodeVideo: { vp9: true }, encodeAudio: { opus: true } },
]

const audioIds = (info: MediaInfo) => info.tracks.filter((t) => t.kind === 'audio').map((t) => t.id)

/** Every planner's answer for one file and one browser, labelled for the failure message. */
function* answers(info: MediaInfo, caps: Capabilities): Generator<[string, Planned]> {
  for (const trackId of [null, ...audioIds(info)])
    for (const format of ['original', 'mp3', 'wav', 'flac'] satisfies AudioFormat[])
      for (const wavBits of [16, 24] as const)
        yield [
          `extract ${trackId} ${format} ${wavBits}`,
          planExtractAudio(info, { trackId, format, mp3Bitrate: 320, wavBits }, CONTAINER_CODECS, caps),
        ]

  for (const container of CONTAINER_CHOICES)
    for (const dropped of [[], ...info.tracks.map((t) => [t.id])])
      yield [`change ${container} −${dropped}`, planChangeContainer(info, container, dropped, CONTAINER_CODECS)]

  for (const keep of [[], ...audioIds(info).map((id) => [id])])
    yield [`remove audio, keep ${keep}`, planRemoveAudio(info, keep, CONTAINER_CODECS)]

  const ranges = [
    { start: 0, end: info.duration },
    { start: 1.3, end: 2 },
    { start: 5, end: 5.01 },
  ]
  for (const range of ranges)
    for (const mode of ['fast', 'precise'] as const)
      yield [`trim ${range.start}–${range.end} ${mode}`, planTrim(info, range, mode, CONTAINER_CODECS, caps)]

  for (const aim of ['quality', 'size'] as const)
    for (const preset of ['smaller', 'high'] as const)
      for (const resolution of ['original', '1080', '720', '480'] as const)
        for (const frameRate of ['original', '24'] as const)
          for (const codec of ['avc', 'hevc', 'vp9', 'av1'] as const)
            for (const audio of ['keep', 'smaller', 'remove'] as const) {
              const settings: CompressSettings = {
                ...DEFAULT_COMPRESS,
                aim,
                preset,
                targetMB: 50,
                resolution,
                frameRate,
                codec,
                audio,
              }
              yield [
                `compress ${Object.values(settings).join(' ')}`,
                planCompress(info, settings, CONTAINER_CODECS, caps),
              ]
            }
}

describe('every planner', () => {
  it('makes only plans that agree with themselves and the file', () => {
    const failures: string[] = []
    let plans = 0
    for (const info of INFOS)
      for (const [c, caps] of CAPS.entries())
        for (const [label, planned] of answers(info, caps)) {
          if (!planned.plan) continue
          plans++
          const problems = planProblems(planned.plan, info)
          if (problems.length) failures.push(`${info.name}, caps ${c}, ${label}: ${problems.join(' ')}`)
        }
    // Enough of the spread produced plans for the check to mean something.
    expect(plans).toBeGreaterThan(1000)
    expect([...new Set(failures.map((f) => f.replace(/, caps \d/, '')))]).toEqual([])
  })
})
