import { codecName, videoTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { FramePlan, Planned } from '../plan'
import { formatTimecode } from '../timecode'

export type FrameFormat = 'png' | 'jpeg'

/** Grab frame (SPEC.md 6.7): the frame showing at `time` (on the playhead's clock), at the video's
 * full display size with rotation applied. Named with the time, `-` for `:` so Windows takes it. */
export function planGrabFrame(info: MediaInfo, time: number, format: FrameFormat): Planned<FramePlan> {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!video.canDecode) {
    return { problems: [`This browser can’t decode ${codecName(video.codec, null)}, so it can’t show a frame.`] }
  }
  const at = Math.min(Math.max(0, time), info.duration)
  const plan: FramePlan = {
    kind: 'frame',
    name: outputName(info.name, ` frame ${formatTimecode(at, { hours: true })}`, format === 'png' ? 'png' : 'jpg'),
    mimeType: format === 'png' ? 'image/png' : 'image/jpeg',
    lossless: false,
    time: at + info.start,
  }
  // The browser's decoder tone-maps HDR; the image can only be SDR.
  const hdr = video.colour.hdr ? ' HDR frames are converted to SDR.' : ''
  return { plan, caption: `The full ${video.width} × ${video.height} frame.${hdr}` }
}
