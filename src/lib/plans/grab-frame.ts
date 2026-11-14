import type { Capabilities } from '../capabilities'
import { codecName, videoTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { FramePlan, Planned } from '../plan'
import { formatTimecode } from '../timecode'

export type FrameFormat = 'png' | 'jpeg' | 'webp'

/** `lossless` is WebP's switch; PNG is always lossless and JPEG never. */
export type FrameSettings = { format: FrameFormat; lossless: boolean }

export const DEFAULT_FRAME: FrameSettings = { format: 'png', lossless: false }

const FORMATS = {
  png: { mimeType: 'image/png', extension: 'png' },
  jpeg: { mimeType: 'image/jpeg', extension: 'jpg' },
  webp: { mimeType: 'image/webp', extension: 'webp' },
} as const

/** Grab frame (SPEC.md 6.7): the frame showing at `time` (on the playhead's clock), at the video's
 * full display size with rotation applied. Named with the time, `-` for `:` so Windows takes it. */
export function planGrabFrame(
  info: MediaInfo,
  time: number,
  { format, lossless }: FrameSettings,
  caps: Capabilities,
): Planned<FramePlan> {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!video.canDecode) {
    return { problems: [`This browser can’t decode ${codecName(video.codec, null)}, so it can’t show a frame.`] }
  }
  if (format === 'webp' && !caps.encodeWebp) {
    return { problems: ['This browser can’t make WebP images. Choose PNG or JPEG.'] }
  }
  const at = Math.min(Math.max(0, time), info.duration)
  const { mimeType, extension } = FORMATS[format]
  const plan: FramePlan = {
    kind: 'frame',
    name: outputName(info.name, ` frame ${formatTimecode(at, { hours: true })}`, extension),
    mimeType,
    // Canvases write lossless WebP at quality 1 (Chrome and Firefox both); PNG takes no quality.
    quality: format === 'png' || (format === 'webp' && lossless) ? 1 : 0.9,
    lossless: false,
    time: at + info.start,
  }
  // The browser's decoder tone-maps HDR; the image can only be SDR.
  const hdr = video.colour.hdr ? ' HDR frames are converted to SDR.' : ''
  return { plan, caption: `The full ${video.width} × ${video.height} frame.${hdr}` }
}
