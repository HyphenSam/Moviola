import type { TimeRange } from './plans/trim'
import { frameDuration, stepFrames } from './timecode'

/** The time at `x` pixels along a strip `width` wide that spans the whole file. */
export function timeAt(x: number, width: number, duration: number): number {
  if (width <= 0) return 0
  return Math.min(Math.max(x / width, 0), 1) * duration
}

/** How many thumbnails of the video's shape (`aspect`, width over height) fill a strip, the last one
 * cut off rather than a gap left. */
export const thumbnailCount = (width: number, aspect: number, height: number) =>
  width > 0 ? Math.ceil(width / (height * aspect) - 1e-9) : 0

/** Evenly spaced times for `count` thumbnails, each from the middle of its stretch of the file. */
export const thumbnailTimes = (duration: number, count: number) =>
  Array.from({ length: count }, (_, i) => ((i + 0.5) * duration) / count)

/** The range with its in point (`start`) or out point (`end`) moved to `time`: on the frame showing
 * there, within the file, and at least a frame from the other point. The out point can also sit at the
 * very end, which needn't fall on the frame grid. */
export function moveEnd(
  range: TimeRange,
  end: 'start' | 'end',
  time: number,
  frameRate: number | null,
  duration: number,
): TimeRange {
  const frame = frameDuration(frameRate)
  const t = time >= duration ? duration : stepFrames(Math.max(0, time), 0, frameRate)
  return end === 'start'
    ? { ...range, start: Math.max(0, Math.min(t, range.end - frame)) }
    : { ...range, end: Math.min(duration, Math.max(t, range.start + frame)) }
}

/** Where the range's grips (`grip` pixels wide) go along a strip `width` wide, as each one's left edge.
 * Each sits just inside its end, flat side facing in; when the range is too short for both, each sits
 * outside its end instead, so neither covers the other. Both stay on the strip, side by side at worst. */
export function gripLefts(range: TimeRange, duration: number, width: number, grip: number) {
  const x = (t: number) => (duration > 0 ? (Math.min(Math.max(t, 0), duration) / duration) * width : 0)
  const [a, b] = [x(range.start), x(range.end)]
  const inside = b - a >= 2 * grip
  const start = Math.min(inside ? a : Math.max(0, a - grip), width - 2 * grip)
  const end = Math.max(Math.min(inside ? b - grip : b, width - grip), start + grip)
  return { start, end }
}
