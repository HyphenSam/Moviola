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
