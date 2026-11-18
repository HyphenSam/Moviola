import {
  ADTS,
  BlobSource,
  EncodedPacketSink,
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
import { isHdrTransfer, PCM_BITS, plainTags, type Container, type MediaInfo, type Track } from '@/lib/info'

export const CANT_OPEN = 'Moviola can’t open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS video.'

// The formats Moviola reads, each with its MediaInfo name. Not ALL_FORMATS: that includes HLS, a
// playlist of other files, which a single File can't be.
export const FORMATS = new Map<InputFormat, Container>([
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
// B-frames come within a group's first few frames; this many packets leaves room for a slow start.
const ORDER_PACKETS = 100

/** Reads what Moviola needs to know about a file. Only the parts of the file Mediabunny asks for are
 * read (the header, the index and the first packets), never the whole of it. */
export async function probe(file: File): Promise<MediaInfo> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const format = await input.getFormat()
    // The length first, then the tracks: Mediabunny 1.65's FLAC reader gets the length and the packet
    // stats wrong (a fraction of a second) when both are read at the same time.
    const [start, end, tags, mimeType] = await Promise.all([
      firstTimestamp(input),
      input.computeDuration(),
      input.getMetadataTags(),
      input.getMimeType(),
    ])
    const tracks = await Promise.all((await input.getTracks()).map(describeTrack))
    return {
      name: file.name,
      size: file.size,
      container: FORMATS.get(format)!,
      mimeType,
      start,
      // computeDuration is the end timestamp; the length runs from the first one. A broken index can put
      // the end before it, and nothing downstream expects a negative length.
      duration: Math.max(0, end - start),
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

/** The time of the keyframe a copy starting at `time` begins on: the one at or before it, or the
 * first, as Mediabunny's own copy picks it (verified from the bitstream, since containers can
 * mislabel). Times count from the playhead's 0. Null for a track that isn't there or has no packets. */
export async function keyframeAt(file: File, trackId: number, time: number): Promise<number | null> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const track = (await input.getTracks()).find((t) => t.id === trackId)
    if (!track) return null
    const start = await firstTimestamp(input)
    const key = await keyTimestamp(track, time + start)
    return key === null ? null : key - start
  } finally {
    input.dispose()
  }
}

/** The timestamp of the keyframe a copy from `timestamp` (the track's own clock) starts on. */
export async function keyTimestamp(track: InputTrack, timestamp: number): Promise<number | null> {
  const sink = new EncodedPacketSink(track)
  const options = { verifyKeyPackets: true }
  const packet = (await sink.getKeyPacket(timestamp, options)) ?? (await sink.getFirstKeyPacket(options))
  return packet?.timestamp ?? null
}

/** Whether a video track stores frames out of display order (B-frames), from its first packets in
 * decode order: an encoder that uses B-frames uses them from the first group on. */
async function storedOutOfOrder(track: InputTrack): Promise<boolean> {
  let last = -Infinity
  let count = 0
  for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
    if (packet.timestamp < last) return true
    last = packet.timestamp
    if (++count >= ORDER_PACKETS) break
  }
  return false
}

/** FLAC's bits per sample, from the STREAMINFO block its decoder description starts with ("fLaC",
 * a 4-byte block header, then 10 bytes of block and frame sizes, 20 bits of sample rate, 3 of
 * channels and 5 of bits per sample, less one). */
function flacBitDepth(config: AudioDecoderConfig | null): number | null {
  const description = config?.description
  if (!description) return null
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description)
  if (bytes.length < 22 || String.fromCharCode(...bytes.subarray(0, 4)) !== 'fLaC') return null
  return (((bytes[20] & 1) << 4) | (bytes[21] >> 4)) + 1
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
    const [width, height, rotation, colour, reordered] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.getRotation(),
      track.getColorSpace(),
      storedOutOfOrder(track),
    ])
    return {
      ...common,
      kind: 'video',
      width,
      height,
      rotation,
      frameRate: stats.averagePacketRate > 0 ? stats.averagePacketRate : null,
      reordered,
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
    const bitDepth = codec === 'flac' ? flacBitDepth(await track.getDecoderConfig()) : codec && PCM_BITS[codec]?.bits
    return { ...common, kind: 'audio', sampleRate, channels, bitDepth: bitDepth ?? null }
  }
  if (track.type === 'subtitle') return { ...common, kind: 'subtitle' }
  return null
}
