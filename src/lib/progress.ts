// Words and numbers for a running job and its result (DESIGN.md: Progress, Exports strip).
import { formatSize } from './info'

/** Rounded down, so 100% only shows once the job is done. */
export const percent = (fraction: number) => `${Math.floor(fraction * 100)}%`

/** Time left, estimated from the time so far, once past 3% (SPEC.md section 7). Null before then
 * or while the job can't say how far it is. */
export function remaining(fraction: number | null, elapsedSeconds: number): string | null {
  if (fraction === null || fraction <= 0.03) return null
  const left = (elapsedSeconds * (1 - fraction)) / fraction
  if (left < 10) return 'A few seconds left'
  const seconds = Math.round(left / 5) * 5
  if (seconds < 60) return `About ${seconds} seconds left`
  const minutes = Math.round(left / 60)
  if (minutes < 60) return `About ${minutes} ${minutes === 1 ? 'minute' : 'minutes'} left`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `About ${hours} ${hours === 1 ? 'hour' : 'hours'}${rest ? ` ${rest} ${rest === 1 ? 'minute' : 'minutes'}` : ''} left`
}

/** "−83%" or "+4%" against the source; null if there's nothing to compare with. Rounded towards
 * zero, so a result that still has bytes never shows as −100%. */
export function sizeChange(size: number, sourceSize: number): string | null {
  if (sourceSize <= 0) return null
  const change = ((size - sourceSize) / sourceSize) * 100
  const shown = Math.trunc(change)
  if (shown === 0) return '±0%'
  return `${shown < 0 ? '−' : '+'}${Math.abs(shown)}%`
}

/** What Compress's export says about a result's size (SPEC.md 6.6): when it missed the target by
 * more than 5% (single-pass encoding can), and when it came out larger than the source. */
export function sizeWarnings(
  size: number,
  sourceSize: number,
  target: number | null,
): { overTarget: string | null; larger: string | null } {
  const over = target ? (size - target) / target : 0
  const grew = sourceSize > 0 ? (size - sourceSize) / sourceSize : 0
  return {
    overTarget: target && over > 0.05 ? `${Math.ceil(over * 100 - 1e-9)}% over the ${formatSize(target)} target.` : null,
    larger:
      grew > 0
        ? `${Math.max(1, Math.round(grew * 100))}% larger than the original. ${target ? 'Try a smaller target.' : 'Try a lower quality.'}`
        : null,
  }
}
