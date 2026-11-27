import { describe, expect, it } from 'vitest'
import {
  audioSummary,
  codecName,
  describeInfo,
  formatBitrate,
  formatFrameRate,
  formatSize,
  hasAudio,
  hasVideo,
  infoAsText,
  isHdrTransfer,
  languageName,
  overallBitrate,
  plainTags,
  type MediaInfo,
} from './info'

const video = (over: Partial<Extract<MediaInfo['tracks'][number], { kind: 'video' }>> = {}) => ({
  kind: 'video' as const,
  id: 1,
  codec: 'avc' as const,
  codecString: 'avc1.640028',
  language: null,
  name: null,
  isDefault: true,
  bitrate: 4_200_000,
  canDecode: true,
  width: 1920,
  height: 1080,
  rotation: 0 as const,
  frameRate: 29.97,
  reordered: true,
  colour: { primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false, hdr: false },
  ...over,
})

const audio = (over: Partial<Extract<MediaInfo['tracks'][number], { kind: 'audio' }>> = {}) => ({
  kind: 'audio' as const,
  id: 2,
  codec: 'aac' as const,
  codecString: 'mp4a.40.2',
  language: 'eng',
  name: null,
  isDefault: true,
  bitrate: 128_000,
  canDecode: true,
  sampleRate: 48000,
  channels: 2,
  bitDepth: null,
  ...over,
})

const info = (over: Partial<MediaInfo> = {}): MediaInfo => ({
  name: 'holiday.mp4',
  size: 12_345_678,
  container: 'mp4',
  mimeType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
  start: 0,
  duration: 83.5,
  tags: {},
  tracks: [video(), audio()],
  ...over,
})

describe('codecName', () => {
  it('names video codecs in plain words, with the profile when the codec string gives it', () => {
    expect(codecName('avc', 'avc1.640028')).toBe('H.264 High')
    expect(codecName('avc', 'avc1.42E01E')).toBe('H.264 Baseline')
    expect(codecName('avc', 'avc1.4D401F')).toBe('H.264 Main')
    expect(codecName('avc', 'avc1.6E0028')).toBe('H.264 High 10')
    expect(codecName('avc', null)).toBe('H.264')
    expect(codecName('hevc', 'hvc1.1.6.L93.B0')).toBe('HEVC Main')
    expect(codecName('hevc', 'hev1.2.4.L120.B0')).toBe('HEVC Main 10')
    expect(codecName('vp8', 'vp8')).toBe('VP8')
    expect(codecName('vp9', 'vp09.00.11.08.01.02.02.02.00')).toBe('VP9 Profile 0')
    expect(codecName('vp9', 'vp09.02.10.10')).toBe('VP9 Profile 2')
    expect(codecName('av1', 'av01.0.08M.08')).toBe('AV1 Main')
    expect(codecName('prores', 'apch')).toBe('ProRes')
  })

  it('names audio and subtitle codecs in plain words', () => {
    expect(codecName('aac', 'mp4a.40.2')).toBe('AAC LC')
    expect(codecName('aac', 'mp4a.40.5')).toBe('HE-AAC')
    expect(codecName('aac', 'mp4a.40.29')).toBe('HE-AAC v2')
    expect(codecName('aac', null)).toBe('AAC')
    expect(codecName('opus', 'opus')).toBe('Opus')
    expect(codecName('vorbis', 'vorbis')).toBe('Vorbis')
    expect(codecName('mp3', 'mp3')).toBe('MP3')
    expect(codecName('flac', 'flac')).toBe('FLAC')
    expect(codecName('ac3', 'ac-3')).toBe('AC-3')
    expect(codecName('eac3', 'ec-3')).toBe('E-AC-3')
    expect(codecName('dts', null)).toBe('DTS')
    expect(codecName('truehd', null)).toBe('TrueHD')
    expect(codecName('pcm-s16', 'pcm-s16')).toBe('PCM 16-bit')
    expect(codecName('pcm-s24be', null)).toBe('PCM 24-bit big-endian')
    expect(codecName('pcm-f32', null)).toBe('PCM 32-bit float')
    expect(codecName('pcm-u8', null)).toBe('PCM 8-bit unsigned')
    expect(codecName('ulaw', null)).toBe('μ-law')
    expect(codecName('alaw', null)).toBe('A-law')
    expect(codecName('webvtt', null)).toBe('WebVTT')
  })

  it('says when the codec is unknown', () => {
    expect(codecName(null, null)).toBe('Unknown codec')
  })
})

describe('isHdrTransfer', () => {
  it('treats PQ and HLG as HDR and everything else as SDR', () => {
    expect(isHdrTransfer('pq')).toBe(true)
    expect(isHdrTransfer('hlg')).toBe(true)
    expect(isHdrTransfer('bt709')).toBe(false)
    expect(isHdrTransfer(undefined)).toBe(false)
  })
})

describe('audioSummary', () => {
  it('gives the sample rate in kHz and the channel layout in words', () => {
    expect(audioSummary(48000, 2)).toBe('48 kHz, stereo')
    expect(audioSummary(44100, 1)).toBe('44.1 kHz, mono')
    expect(audioSummary(22050, 6)).toBe('22.05 kHz, 5.1')
    expect(audioSummary(48000, 8)).toBe('48 kHz, 7.1')
    expect(audioSummary(96000, 4)).toBe('96 kHz, 4 channels')
  })
})

describe('formatting', () => {
  it('formats sizes in decimal units', () => {
    expect(formatSize(999)).toBe('999 bytes')
    expect(formatSize(1)).toBe('1 byte')
    expect(formatSize(12_345)).toBe('12.3 kB')
    expect(formatSize(12_345_678)).toBe('12.3 MB')
    expect(formatSize(4_200_000_000)).toBe('4.2 GB')
  })

  it('formats bitrates in kbps and Mbps', () => {
    expect(formatBitrate(131_630)).toBe('132 kbps')
    expect(formatBitrate(4_210_000)).toBe('4.2 Mbps')
    expect(formatBitrate(25_000_000)).toBe('25 Mbps')
  })

  it('formats frame rates without trailing zeros', () => {
    expect(formatFrameRate(25)).toBe('25 fps')
    expect(formatFrameRate(30000 / 1001)).toBe('29.97 fps')
    expect(formatFrameRate(24000 / 1001)).toBe('23.976 fps')
  })

  it('names languages from their ISO 639 codes, and nothing for undetermined', () => {
    expect(languageName('eng')).toBe('English')
    expect(languageName('fra')).toBe('French')
    expect(languageName('und')).toBeNull()
    expect(languageName(null)).toBeNull()
    expect(languageName('qqq')).toBe('qqq')
  })
})

describe('helpers', () => {
  it('works out the overall bitrate from size and duration', () => {
    expect(overallBitrate(info({ size: 1_000_000, duration: 8 }))).toBe(1_000_000)
    expect(overallBitrate(info({ duration: 0 }))).toBeNull()
  })

  it('knows whether a file has video and audio', () => {
    expect(hasVideo(info())).toBe(true)
    expect(hasAudio(info())).toBe(true)
    expect(hasVideo(info({ tracks: [audio()] }))).toBe(false)
    expect(hasAudio(info({ tracks: [video()] }))).toBe(false)
  })

  it('turns Mediabunny metadata tags into plain strings, skipping images and empty values', () => {
    expect(
      plainTags({
        title: 'Beach',
        artist: 'Sam',
        date: new Date('2024-07-01T00:00:00Z'),
        creationTime: new Date('2024-07-01T10:20:30Z'),
        trackNumber: 3,
        comment: '',
        images: [],
        raw: { foo: 'bar' },
      }),
    ).toEqual({
      title: 'Beach',
      artist: 'Sam',
      date: '2024-07-01',
      creationTime: '2024-07-01 10:20:30 UTC',
      trackNumber: '3',
    })
  })
})

describe('describeInfo', () => {
  it('describes the file, each track and the tags in groups of rows', () => {
    const groups = describeInfo(
      info({
        tags: { title: 'Beach', creationTime: '2024-07-01 10:20:30 UTC' },
        tracks: [
          video(),
          audio(),
          audio({
            id: 3,
            language: 'fra',
            name: 'Commentary',
            isDefault: false,
            codec: 'ac3',
            codecString: 'ac-3',
            canDecode: false,
            channels: 6,
            bitrate: null,
          }),
        ],
      }),
    )
    expect(groups.map((g) => g.title)).toEqual(['File', 'Video track 1', 'Audio track 1', 'Audio track 2', 'Tags'])
    expect(groups[0].rows).toEqual([
      { label: 'Name', value: 'holiday.mp4' },
      { label: 'Size', value: '12.3 MB', caption: '12,345,678 bytes' },
      { label: 'Container', value: 'MP4' },
      { label: 'Duration', value: '1:23.500' },
      { label: 'Overall bitrate', value: 'about 1.2 Mbps' },
    ])
    expect(groups[1].rows).toEqual([
      { label: 'Codec', value: 'H.264 High', caption: 'avc1.640028' },
      { label: 'Size', value: '1920 × 1080' },
      { label: 'Frame rate', value: '29.97 fps' },
      { label: 'Rotation', value: 'None' },
      { label: 'Colour', value: 'SDR, BT.709' },
      { label: 'Bitrate', value: 'about 4.2 Mbps' },
      { label: 'Default', value: 'Yes' },
    ])
    expect(groups[2].rows).toEqual([
      { label: 'Codec', value: 'AAC LC', caption: 'mp4a.40.2' },
      { label: 'Audio', value: '48 kHz, stereo' },
      { label: 'Bitrate', value: 'about 128 kbps' },
      { label: 'Language', value: 'English' },
      { label: 'Default', value: 'Yes' },
    ])
    expect(groups[3].rows).toEqual([
      { label: 'Codec', value: 'AC-3', caption: 'ac-3' },
      { label: 'Audio', value: '48 kHz, 5.1' },
      { label: 'Language', value: 'French' },
      { label: 'Name', value: 'Commentary' },
      { label: 'Default', value: 'No' },
      { label: 'Decoding', value: 'Can’t decode in this browser' },
    ])
    expect(groups[4].rows).toEqual([
      { label: 'Title', value: 'Beach' },
      { label: 'Created', value: '2024-07-01 10:20:30 UTC' },
    ])
  })

  it('shows rotation, HDR colour and an unknown frame rate', () => {
    const [, track] = describeInfo(
      info({
        tracks: [
          video({
            rotation: 90,
            width: 1080,
            height: 1920,
            frameRate: null,
            colour: { primaries: 'bt2020', transfer: 'hlg', hdr: true },
          }),
        ],
      }),
    )
    expect(track.rows).toContainEqual({ label: 'Rotation', value: '90°' })
    expect(track.rows).toContainEqual({ label: 'Colour', value: 'HDR, BT.2020, HLG' })
    expect(track.rows.find((r) => r.label === 'Frame rate')).toBeUndefined()
  })

  it('says when the first video track’s frames change size as it plays, and from what to what', () => {
    const shrinking = { smallest: { width: 960, height: 1 }, largest: { width: 960, height: 720 }, changes: 90 }
    const [, first, second] = describeInfo(
      info({ tracks: [video({ codec: 'vp9', width: 960, height: 720 }), video({ id: 2 })] }),
      shrinking,
    )
    expect(first.rows).toContainEqual({
      label: 'Size',
      value: '960 × 720, changes as it plays',
      caption: '960 × 1 to 960 × 720, 90 changes',
    })
    expect(second.rows).toContainEqual({ label: 'Size', value: '1920 × 1080' })
  })

  it('counts a single size change as one', () => {
    const once = { smallest: { width: 640, height: 360 }, largest: { width: 1280, height: 720 }, changes: 1 }
    const [, track] = describeInfo(info({ tracks: [video({ width: 1280, height: 720 })] }), once)
    expect(track.rows).toContainEqual(expect.objectContaining({ caption: '640 × 360 to 1280 × 720, 1 change' }))
  })

  it('says it’s still checking for size changes', () => {
    const [, track] = describeInfo(info(), 'checking')
    expect(track.rows).toContainEqual({ label: 'Size', value: '1920 × 1080', caption: 'Checking for size changes…' })
  })

  it('leaves the tags group out when there are none', () => {
    expect(describeInfo(info()).map((g) => g.title)).not.toContain('Tags')
  })
})

describe('infoAsText', () => {
  it('copies the size changes with the size', () => {
    const changes = { smallest: { width: 960, height: 1 }, largest: { width: 960, height: 720 }, changes: 90 }
    expect(infoAsText(info({ tracks: [video({ width: 960, height: 720 })] }), changes)).toContain(
      'Size: 960 × 720, changes as it plays (960 × 1 to 960 × 720, 90 changes)',
    )
  })

  it('writes one Key: value per line, a heading per group and a blank line between groups', () => {
    const text = infoAsText(info({ tracks: [audio({ language: null })] }))
    expect(text).toBe(
      [
        'File',
        'Name: holiday.mp4',
        'Size: 12.3 MB (12,345,678 bytes)',
        'Container: MP4',
        'Duration: 1:23.500',
        'Overall bitrate: about 1.2 Mbps',
        '',
        'Audio track 1',
        'Codec: AAC LC (mp4a.40.2)',
        'Audio: 48 kHz, stereo',
        'Bitrate: about 128 kbps',
        'Default: Yes',
      ].join('\n'),
    )
  })
})
