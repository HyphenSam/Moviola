// Compress's sums (SPEC.md 6.6): the bitrate a target size leaves for the video, the floor below which
// a picture falls apart, the output size and frame rate.
import type { VideoEncodeCodec } from './capabilities'

/** The share of a target size the media gets; the rest is room for the container. */
const MEDIA_SHARE = 0.98

/** Below this many bits per pixel per frame, video breaks into blocks; a target that leaves less is
 * refused. */
export const MIN_BITS_PER_PIXEL = 0.02

/** What a source whose frame rate isn't known is assumed to run at. */
const ASSUMED_FRAME_RATE = 30

/** The video bitrate that fits `targetBytes` over `duration` seconds once the audio
 * (`audioBitrate`, bits per second) has its share; zero or less when the audio alone fills it. A
 * whole number, as Mediabunny needs. */
export function targetVideoBitrate(targetBytes: number, duration: number, audioBitrate: number): number {
  if (duration <= 0) return 0
  return Math.floor((targetBytes * 8 * MEDIA_SHARE - audioBitrate * duration) / duration)
}

export function bitsPerPixel(bitrate: number, width: number, height: number, frameRate: number | null): number {
  return bitrate / (width * height * (frameRate ?? ASSUMED_FRAME_RATE))
}

// H.264 and HEVC need even sizes (CLAUDE.md); a tiny epsilon keeps 1279.9999 from becoming 1278.
const even = (n: number) => Math.max(2, Math.floor((n + 1e-9) / 2) * 2)

/** The output size for a source shown at `width` × `height` (after rotation) when its shorter side
 * is to be `shorter` pixels (null for Original): the aspect ratio kept, never larger than the
 * source, each side rounded down to an even number. */
export function scaledSize(width: number, height: number, shorter: number | null): { width: number; height: number } {
  const side = Math.min(width, height)
  if (shorter === null || shorter >= side) return { width: even(width), height: even(height) }
  return { width: even((width * shorter) / side), height: even((height * shorter) / side) }
}

/** Whether `shorter` is a size this source can be scaled to: never up. */
export const canScaleTo = (width: number, height: number, shorter: number) => shorter <= Math.min(width, height)

/** The frame rate to encode at: the cap when the source is faster (or its rate unknown, as variable
 * frame rates are), else null, meaning the source's own. Never raises it. */
export const cappedFrameRate = (source: number | null, cap: number | null): number | null =>
  cap !== null && canCapFrameRate(source, cap) ? cap : null

export const canCapFrameRate = (source: number | null, cap: number) => source === null || source > cap

export type QualityPreset = 'smaller' | 'balanced' | 'high'

/** Mediabunny's quality level for each preset (its `QUALITY_LOW`, `QUALITY_MEDIUM`, `QUALITY_HIGH`),
 * whose bitrate Compress uses. */
export const PRESET_LEVELS: Record<QualityPreset, 'low' | 'medium' | 'high'> = {
  smaller: 'low',
  balanced: 'medium',
  high: 'high',
}
const LEVELS = { low: 0.25, medium: 0.5, high: 0.75 }
const EFFICIENCY: Record<VideoEncodeCodec, number> = { avc: 1, hevc: 0.6, vp9: 0.6, av1: 0.4 }

/** The bitrate Mediabunny gives a preset's quality level, which Compress encodes at (capped at the
 * source's). Mediabunny keeps the sum private, so this repeats it (`encode.js`, `computeVideoBitrate`);
 * `src/media/bitrate.test.ts` checks the two agree. */
export function presetBitrate(codec: VideoEncodeCodec, width: number, height: number, preset: QualityPreset): number {
  const factor = 0.3 * Math.exp(2.5538 * LEVELS[PRESET_LEVELS[preset]])
  const scale = Math.pow((width * height) / (1920 * 1080), 0.95)
  return Math.ceil((3_000_000 * scale * EFFICIENCY[codec] * factor) / 1000) * 1000
}

/** Target size's starting value: half the source, to the nearest whole MB, at least 1. */
export const defaultTargetMB = (sourceBytes: number) => Math.max(1, Math.round(sourceBytes / 2 / 1_000_000))
