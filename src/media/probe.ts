import {
  ADTS,
  BlobSource,
  FLAC,
  Input,
  MATROSKA,
  MP3,
  MP4,
  MPEG_TS,
  OGG,
  QTFF,
  UnsupportedInputFormatError,
  WAVE,
  WEBM,
  type InputFormat,
  type InputTrack,
} from 'mediabunny'
import { isHdrTransfer, plainTags, type Container, type MediaInfo, type Track } from '@/lib/info'

export const CANT_OPEN = 'Moviola can’t open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS video.'

// The formats Moviola reads, each with its MediaInfo name. Not ALL_FORMATS: that includes HLS, a
// playlist of other files, which a single File can't be.
const FORMATS = new Map<InputFormat, Container>([
  [MP4, 'mp4'],
  [QTFF, 'mov'],
  [WEBM, 'webm'],
  [MATROSKA, 'mkv'],
  [MPEG_TS, 'mpegts'],
  [MP3, 'mp3'],
  [WAVE, 'wav'],
  [FLAC, 'flac'],
  [OGG, 'ogg'],
  [ADTS, 'adts'],
])

// Enough packets for a fair bitrate and frame rate without reading a long file to the end.
const STATS_PACKETS = 1000

/** Reads what Moviola needs to know about a file. Only the parts of the file Mediabunny asks for are
 * read (the header, the index and the first packets), never the whole of it. */
export async function probe(file: File): Promise<MediaInfo> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const format = await input.getFormat()
    const [tracks, start, end, tags, mimeType] = await Promise.all([
      input.getTracks().then((all) => Promise.all(all.map(describeTrack))),
      firstTimestamp(input),
      input.computeDuration(),
      input.getMetadataTags(),
      input.getMimeType(),
    ])
    return {
      name: file.name,
      size: file.size,
      container: FORMATS.get(format)!,
      mimeType,
      start,
      // computeDuration is the end timestamp; the length runs from the first one.
      duration: end - start,
      tags: plainTags(tags),
      tracks: tracks.filter((t) => t !== null),
    }
  } catch (error) {
    if (error instanceof UnsupportedInputFormatError) throw new Error(CANT_OPEN)
    throw error
  } finally {
    input.dispose()
  }
}

/** Where the playhead's 0 sits. Negative timestamps (AAC priming in MP4) are never shown, so they
 * don't count; a late start (MPEG-TS) does. */
export async function firstTimestamp(input: Input): Promise<number> {
  return Math.max(0, await input.getFirstTimestamp())
}

async function describeTrack(track: InputTrack): Promise<Track | null> {
  const [codec, codecString, language, name, disposition, stats, canDecode] = await Promise.all([
    track.getCodec(),
    track.getCodecParameterString(),
    track.getLanguageCode(),
    track.getName(),
    track.getDisposition(),
    track.computePacketStats(STATS_PACKETS),
    track.canDecode(),
  ])
  const common = {
    id: track.id,
    codec,
    codecString,
    language: language === 'und' ? null : language,
    name,
    isDefault: disposition.default,
    bitrate: stats.averageBitrate > 0 ? Math.round(stats.averageBitrate) : null,
    canDecode,
  }

  if (track.isVideoTrack()) {
    const [width, height, rotation, colour] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getRotation(),
      track.getColorSpace(),
    ])
    return {
      ...common,
      kind: 'video',
      width,
      height,
      rotation,
      frameRate: stats.averagePacketRate > 0 ? stats.averagePacketRate : null,
      colour: {
        ...(colour.primaries && { primaries: colour.primaries }),
        ...(colour.transfer && { transfer: colour.transfer }),
        ...(colour.matrix && { matrix: colour.matrix }),
        ...(colour.fullRange != null && { fullRange: colour.fullRange }),
        hdr: isHdrTransfer(colour.transfer ?? undefined),
      },
    }
  }
  if (track.isAudioTrack()) {
    const [sampleRate, channels] = await Promise.all([track.getSampleRate(), track.getNumberOfChannels()])
    return { ...common, kind: 'audio', sampleRate, channels }
  }
  if (track.type === 'subtitle') return { ...common, kind: 'subtitle' }
  return null
}
