/** A length to the nearest second: `m:ss`, or `h:mm:ss` from an hour. */
export function formatDuration(seconds: number): string {
  return formatTimecode(Math.round(Math.max(0, seconds) || 0)).replace(/\.000$/, '')
}

/** `m:ss.mmm`, or `h:mm:ss.mmm` from an hour (or always, with `hours`, so a running clock's digits
 * don't jump when the file is longer than an hour). */
export function formatTimecode(seconds: number, { hours = false }: { hours?: boolean } = {}): string {
  // Whole milliseconds first, so 59.9996 becomes 1:00.000 rather than 0:60.000.
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0
  const ms = total % 1000
  const s = Math.floor(total / 1000) % 60
  const m = Math.floor(total / 60_000) % 60
  const h = Math.floor(total / 3_600_000)
  const tail = `${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
  return h > 0 || hours ? `${h}:${String(m).padStart(2, '0')}:${tail}` : `${m}:${tail}`
}

// `90`, `1:30`, `1:30.5`, `0:01:30.500`: up to two whole-number parts, then seconds with an optional
// fraction.
const TIMECODE = /^(?:(\d+):)?(?:(\d+):)?(\d+(?:\.\d*)?|\.\d+)$/

/** A time typed into a timecode field, in seconds rounded to the millisecond, or null if it isn't
 * one. Seconds can run past 59 only on their own (`90`); after minutes they can't, nor minutes past
 * 59 after hours. */
export function parseTimecode(text: string): number | null {
  const match = TIMECODE.exec(text.trim())
  if (!match) return null
  const [, first, second, secondsText] = match
  const [hours, minutes] = second !== undefined ? [Number(first), Number(second)] : [0, Number(first ?? 0)]
  const seconds = Number(secondsText)
  if ((first !== undefined && seconds >= 60) || (second !== undefined && minutes >= 60)) return null
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000) / 1000
}

/** How long a frame lasts; 30 fps when the rate is unknown. */
export const frameDuration = (frameRate: number | null) => 1 / (frameRate ?? 30)

/** The time `frames` frames on (or back) from the frame showing at `time`, on the frame grid. A
 * time inside a frame belongs to that frame; the millisecond's allowance keeps a boundary that comes
 * back a hair short on its own frame: floating point (0.12 × 25 = 2.9999…), or a media element
 * cutting the time to the microsecond (Chrome reads a seek to 1 / 30 back as 0.033333). */
export function stepFrames(time: number, frames: number, frameRate: number | null): number {
  const rate = frameRate ?? 30
  const showing = Math.floor((time + 0.001) * rate)
  return Math.max(0, showing + frames) / rate
}
