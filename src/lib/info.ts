import type { MediaCodec, MetadataTags, Rotation } from 'mediabunny'
import { formatTimecode } from './timecode'

/** What the planners and the UI know about the open file (SPEC.md section 4). Plain data: it crosses
 * from the worker by structured clone. */
export type MediaInfo = {
  name: string
  size: number // bytes
  container: Container
  /** The full MIME type with codecs, for asking the browser whether it can play the file. */
  mimeType: string
  /** The first timestamp in the file, in seconds. Usually 0; MPEG-TS often starts later. The
   * playhead counts from here, so its 0 is this timestamp in the file. */
  start: number
  duration: number // seconds, from `start` to the end
  tags: Record<string, string>
  tracks: Track[]
}

export type Container = 'mp4' | 'mov' | 'mkv' | 'webm' | 'mpegts' | 'mp3' | 'wav' | 'flac' | 'ogg' | 'adts'

type Common = {
  id: number // Mediabunny's track id, unique within the file
  codec: MediaCodec | null // null when Mediabunny doesn't know the codec
  codecString: string | null // full codec string ('avc1.64001f'), for the info view
  language: string | null // ISO 639-2, null when undetermined
  name: string | null
  isDefault: boolean
  bitrate: number | null // bits per second, measured over the first packets
  canDecode: boolean
}

export type VideoTrack = Common & {
  kind: 'video'
  width: number // display size, after pixel aspect ratio and rotation
  height: number
  rotation: Rotation
  frameRate: number | null
  /** Frames stored out of display order (B-frames), which Firefox seeks short in Matroska. */
  reordered: boolean
  colour: { primaries?: string; transfer?: string; matrix?: string; fullRange?: boolean; hdr: boolean }
}
export type AudioTrack = Common & {
  kind: 'audio'
  sampleRate: number
  channels: number
  bitDepth: number | null // bits per sample of lossless audio (PCM, FLAC); null for lossy codecs
}
export type SubtitleTrack = Common & { kind: 'subtitle' }
export type Track = VideoTrack | AudioTrack | SubtitleTrack

/** Bits per sample of each PCM codec, as stored. Floats are marked, since no integer depth holds
 * them exactly. μ-law and A-law store 8 bits that expand to 14. */
export const PCM_BITS: Partial<Record<MediaCodec, { bits: number; float?: true }>> = {
  'pcm-u8': { bits: 8 },
  'pcm-s8': { bits: 8 },
  ulaw: { bits: 8 },
  alaw: { bits: 8 },
  'pcm-s16': { bits: 16 },
  'pcm-s16be': { bits: 16 },
  'pcm-s24': { bits: 24 },
  'pcm-s24be': { bits: 24 },
  'pcm-s32': { bits: 32 },
  'pcm-s32be': { bits: 32 },
  'pcm-f32': { bits: 32, float: true },
  'pcm-f32be': { bits: 32, float: true },
  'pcm-f64': { bits: 64, float: true },
  'pcm-f64be': { bits: 64, float: true },
}

export const hasVideo = (info: MediaInfo) => info.tracks.some((t) => t.kind === 'video')
export const hasAudio = (info: MediaInfo) => info.tracks.some((t) => t.kind === 'audio')
export const videoTrack = (info: MediaInfo) => info.tracks.find((t): t is VideoTrack => t.kind === 'video') ?? null

export const CONTAINER_NAMES: Record<Container, string> = {
  mp4: 'MP4',
  mov: 'MOV',
  mkv: 'MKV',
  webm: 'WebM',
  mpegts: 'MPEG-TS',
  mp3: 'MP3',
  wav: 'WAV',
  flac: 'FLAC',
  ogg: 'Ogg',
  adts: 'AAC (ADTS)',
}

/** Codec names in plain words, the one table the UI names codecs from. */
const CODEC_NAMES: Record<MediaCodec, string> = {
  avc: 'H.264',
  hevc: 'HEVC',
  vp8: 'VP8',
  vp9: 'VP9',
  av1: 'AV1',
  prores: 'ProRes',
  aac: 'AAC',
  opus: 'Opus',
  vorbis: 'Vorbis',
  mp3: 'MP3',
  flac: 'FLAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  dts: 'DTS',
  truehd: 'TrueHD',
  'pcm-s16': 'PCM 16-bit',
  'pcm-s16be': 'PCM 16-bit big-endian',
  'pcm-s24': 'PCM 24-bit',
  'pcm-s24be': 'PCM 24-bit big-endian',
  'pcm-s32': 'PCM 32-bit',
  'pcm-s32be': 'PCM 32-bit big-endian',
  'pcm-f32': 'PCM 32-bit float',
  'pcm-f32be': 'PCM 32-bit float big-endian',
  'pcm-f64': 'PCM 64-bit float',
  'pcm-f64be': 'PCM 64-bit float big-endian',
  'pcm-u8': 'PCM 8-bit unsigned',
  'pcm-s8': 'PCM 8-bit',
  ulaw: 'μ-law',
  alaw: 'A-law',
  webvtt: 'WebVTT',
}

// Profiles worth naming, read from the codec string (RFC 6381 and the codecs' own registrations).
const AVC_PROFILES: Record<string, string> = {
  '42': 'Baseline',
  '4d': 'Main',
  '58': 'Extended',
  '64': 'High',
  '6e': 'High 10',
  '7a': 'High 4:2:2',
  f4: 'High 4:4:4',
}
const HEVC_PROFILES: Record<string, string> = {
  '1': 'Main',
  '2': 'Main 10',
  '3': 'Main Still Picture',
  '4': 'Range extensions',
}
const AV1_PROFILES: Record<string, string> = { '0': 'Main', '1': 'High', '2': 'Professional' }
const AAC_PROFILES: Record<string, string> = { '2': 'AAC LC', '5': 'HE-AAC', '29': 'HE-AAC v2', '1': 'AAC Main' }

function profile(codec: MediaCodec, codecString: string): string | null {
  const parts = codecString.toLowerCase().split('.')
  switch (codec) {
    case 'avc':
      return AVC_PROFILES[parts[1]?.slice(0, 2)] ?? null
    case 'hevc':
      return HEVC_PROFILES[parts[1]?.replace(/^[abc]/, '')] ?? null
    case 'vp9':
      return parts[1] ? `Profile ${Number(parts[1])}` : null
    case 'av1':
      return AV1_PROFILES[parts[1]] ?? null
    default:
      return null
  }
}

/** "H.264 High", "AAC LC", "Opus": the codec in plain words, with the profile when it's known. */
export function codecName(codec: MediaCodec | null, codecString: string | null): string {
  if (!codec) return 'Unknown codec'
  if (codec === 'aac') return (codecString && AAC_PROFILES[codecString.split('.')[2]]) || 'AAC'
  const p = codecString ? profile(codec, codecString) : null
  return p ? `${CODEC_NAMES[codec]} ${p}` : CODEC_NAMES[codec]
}

/** The hint for a track left out of a copy because Mediabunny can't name its codec. */
export const unnamedCodecHint = (track: Track) =>
  `Moviola can’t tell which codec ${track.kind === 'audio' ? 'an audio' : `a ${track.kind}`} track uses, so it’s left out.`

/** PQ (HDR10, Dolby Vision) and HLG are the HDR transfer functions; everything else is SDR. */
export const isHdrTransfer = (transfer: string | undefined) => transfer === 'pq' || transfer === 'hlg'

const CHANNELS: Record<number, string> = { 1: 'mono', 2: 'stereo', 6: '5.1', 8: '7.1' }

/** "48 kHz, stereo". */
export function audioSummary(sampleRate: number, channels: number): string {
  return `${trim(sampleRate / 1000, 2)} kHz, ${CHANNELS[channels] ?? `${channels} channels`}`
}

/** Decimal units (1 MB = 1,000,000 bytes), as Compress's target size uses. */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return bytes === 1 ? '1 byte' : `${bytes} bytes`
  const units = ['kB', 'MB', 'GB', 'TB']
  let value = bytes / 1000
  let unit = 0
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 100 ? trim(value, 1) : Math.round(value)} ${units[unit]}`
}

export function formatBitrate(bps: number): string {
  if (bps < 1_000_000) return `${Math.round(bps / 1000)} kbps`
  const mbps = bps / 1_000_000
  return `${mbps < 10 ? trim(mbps, 1) : Math.round(mbps)} Mbps`
}

export const formatFrameRate = (fps: number) => `${trim(fps, 3)} fps`

const languages = new Intl.DisplayNames(['en-GB'], { type: 'language', fallback: 'none' })

/** "English" from 'eng'; null for undetermined; the code itself when there's no name for it. */
export function languageName(code: string | null): string | null {
  if (!code || code === 'und') return null
  try {
    return languages.of(code) ?? code
  } catch {
    return code
  }
}

export function overallBitrate(info: MediaInfo): number | null {
  return info.duration > 0 ? (info.size * 8) / info.duration : null
}

/** Mediabunny's metadata as plain strings: dates as ISO dates, numbers as numbers, cover art and raw
 * tags left out (Media info lists the readable ones). */
export function plainTags(tags: MetadataTags): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(tags)) {
    if (key === 'images' || key === 'raw' || value == null || value === '') continue
    if (value instanceof Date) {
      out[key] =
        key === 'date' ? value.toISOString().slice(0, 10) : `${value.toISOString().slice(0, 19).replace('T', ' ')} UTC`
    } else if (typeof value === 'string' || typeof value === 'number') {
      out[key] = String(value)
    }
  }
  return out
}

const TAG_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  artist: 'Artist',
  album: 'Album',
  albumArtist: 'Album artist',
  trackNumber: 'Track number',
  tracksTotal: 'Tracks',
  discNumber: 'Disc number',
  discsTotal: 'Discs',
  beatsPerMinute: 'BPM',
  genre: 'Genre',
  date: 'Date',
  lyrics: 'Lyrics',
  comment: 'Comment',
  creationTime: 'Created',
}

// Colour standards as people write them.
const COLOUR_NAMES: Record<string, string> = {
  bt709: 'BT.709',
  bt470bg: 'BT.601',
  smpte170m: 'BT.601',
  bt2020: 'BT.2020',
  smpte432: 'Display P3',
  pq: 'PQ',
  hlg: 'HLG',
  srgb: 'sRGB',
  linear: 'linear',
}

export type InfoRow = { label: string; value: string; caption?: string }
export type InfoGroup = { title: string; rows: InfoRow[] }

const KIND_TITLES = { video: 'Video track', audio: 'Audio track', subtitle: 'Subtitle track' }

/** Everything Media info shows, as groups of rows: the view renders them and "Copy as text" writes
 * them, so the two never disagree. */
export function describeInfo(info: MediaInfo): InfoGroup[] {
  const overall = overallBitrate(info)
  const groups: InfoGroup[] = [
    {
      title: 'File',
      rows: [
        { label: 'Name', value: info.name },
        { label: 'Size', value: formatSize(info.size), caption: `${info.size.toLocaleString('en-GB')} bytes` },
        { label: 'Container', value: CONTAINER_NAMES[info.container] },
        { label: 'Duration', value: formatTimecode(info.duration) },
        ...(overall ? [{ label: 'Overall bitrate', value: `about ${formatBitrate(overall)}` }] : []),
      ],
    },
  ]

  const counts = { video: 0, audio: 0, subtitle: 0 }
  for (const track of info.tracks) {
    const rows: InfoRow[] = [
      {
        label: 'Codec',
        value: codecName(track.codec, track.codecString),
        ...(track.codecString ? { caption: track.codecString } : {}),
      },
    ]
    if (track.kind === 'video') {
      rows.push({ label: 'Size', value: `${track.width} × ${track.height}` })
      if (track.frameRate) rows.push({ label: 'Frame rate', value: formatFrameRate(track.frameRate) })
      rows.push({ label: 'Rotation', value: track.rotation ? `${track.rotation}°` : 'None' })
      const { primaries, transfer, hdr } = track.colour
      const standards = [primaries, hdr ? transfer : undefined]
        .filter((s): s is string => !!s)
        .map((s) => COLOUR_NAMES[s] ?? s)
      rows.push({ label: 'Colour', value: [hdr ? 'HDR' : 'SDR', ...new Set(standards)].join(', ') })
    } else if (track.kind === 'audio') {
      rows.push({ label: 'Audio', value: audioSummary(track.sampleRate, track.channels) })
    }
    if (track.bitrate) rows.push({ label: 'Bitrate', value: `about ${formatBitrate(track.bitrate)}` })
    const language = languageName(track.language)
    if (language) rows.push({ label: 'Language', value: language })
    if (track.name) rows.push({ label: 'Name', value: track.name })
    rows.push({ label: 'Default', value: track.isDefault ? 'Yes' : 'No' })
    if (!track.canDecode) rows.push({ label: 'Decoding', value: 'Can’t decode in this browser' })
    groups.push({ title: `${KIND_TITLES[track.kind]} ${++counts[track.kind]}`, rows })
  }

  const tags = Object.entries(info.tags)
  if (tags.length) {
    groups.push({ title: 'Tags', rows: tags.map(([key, value]) => ({ label: TAG_LABELS[key] ?? key, value })) })
  }
  return groups
}

/** One `Key: value` per line, a heading per group, for pasting into a forum post or bug report. */
export function infoAsText(info: MediaInfo): string {
  return describeInfo(info)
    .map((group) =>
      [group.title, ...group.rows.map((r) => `${r.label}: ${r.value}${r.caption ? ` (${r.caption})` : ''}`)].join('\n'),
    )
    .join('\n\n')
}

/** Rounds to `places` decimals and drops trailing zeros. */
function trim(value: number, places: number): string {
  return String(Number(value.toFixed(places)))
}
