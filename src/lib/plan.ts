import type { VideoEncodeCodec } from './capabilities'
import type { OutputContainer } from './containers'

/** The codecs audio is converted to: Extract audio's, and Compress's AAC and Opus. PCM is written by
 * Mediabunny itself; MP3, FLAC and AAC may need an add-on encoder (`src/media/encoders.ts`). */
export type AudioEncodeTarget = 'mp3' | 'flac' | 'aac' | 'opus' | 'pcm-s16' | 'pcm-s24'

/** A job, as plain data: what the worker should write. Planners make one from the source's
 * MediaInfo and the tool's settings; `src/media/run.ts` turns it into a Mediabunny Conversion.
 * Every track is copied as is (`copy: { mode: 'forced' }`) unless the plan says to re-encode it. */
export type Plan = {
  /** What the result holds, for the exports strip's icon. */
  kind: 'audio' | 'video'
  container: OutputContainer
  /** The suggested file name, with its extension. */
  name: string
  /** For the save dialog and the downloaded file. */
  mimeType: string
  /** The badge beside the action: no quality is lost. */
  lossless: boolean
  /** The source track ids to keep; every other track is left out. */
  keep: number[]
  /** Cut to this range, in the source's own timestamps (MediaInfo `start` added). Copied video starts
   * on the keyframe at or before `start`. */
  trim?: { start: number; end: number }
  /** Re-encode the kept video to this codec, at this bitrate (or the encoder's choice), resized to `width` × `height` (the display size, after rotation) and capped at
   * `frameRate`; without it, video is copied. */
  video?: {
    codec: VideoEncodeCodec
    bitrate?: number
    /** Hold the bitrate steady, as a target size needs; otherwise it varies with the picture. */
    constantBitrate?: boolean
    width?: number
    height?: number
    frameRate?: number
  }
  /** Re-encode the kept audio to this codec; without it, audio is copied. The source's sample rate
   * and channels are kept unless `sampleRate` or `numberOfChannels` say otherwise. */
  audio?: {
    codec: AudioEncodeTarget
    bitrate?: number
    numberOfChannels?: number
    sampleRate?: number
    /** The samples' format before encoding, which sets FLAC's depth: 's16' for 16 bits, 's32' for 24. */
    sampleFormat?: 's16' | 's32'
  }
  /** Compress's results are checked once written: against the source's size, and against the target
   * (bytes) when the user aimed for one. */
  sizeCheck?: { target: number | null }
}

/** A planner's answer: a plan, the caption under the badge, the badge's own words when Lossless or
 * Re-encodes would mislead, and hints worth knowing; or the reasons the job can't run, each a
 * sentence for the user. */
export type Planned =
  | { plan: Plan; caption: string; badge?: string; hints?: string[]; problems?: never }
  | { plan?: never; caption?: never; badge?: never; hints?: never; problems: string[] }
