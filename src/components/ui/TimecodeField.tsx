import { useEffect, useState } from 'react'
import { cn } from '@/lib/cn'
import { formatTimecode, parseTimecode } from '@/lib/timecode'

/** A time in the timecode face (DESIGN.md). Takes `90`, `1:30`, `1:30.5` or `0:01:30.500`; when it's
 * left (or Enter is pressed) the time is kept within 0 to `max` and written out in full, and anything
 * that isn't a time goes back to the last good one. */
export function TimecodeField({
  label,
  value,
  max,
  onChange,
  className,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
  className?: string
}) {
  const hours = max >= 3600
  const shown = formatTimecode(value, { hours })
  const [text, setText] = useState(shown)
  useEffect(() => setText(shown), [shown])

  function commit() {
    const typed = parseTimecode(text)
    if (typed === null) return setText(shown)
    const time = Math.min(typed, max)
    setText(formatTimecode(time, { hours }))
    if (time !== value) onChange(time)
  }

  return (
    <input
      aria-label={label}
      type="text"
      inputMode="decimal"
      spellCheck={false}
      autoComplete="off"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
      className={cn(
        'h-8 w-full min-w-0 rounded-control bg-panel px-2.5 font-mono text-[13px] font-medium shadow-[0_0_0_1px_var(--color-line-strong)] outline-none focus-visible:shadow-[0_0_0_1.5px_var(--color-focus)] focus-visible:outline-none',
        className,
      )}
    />
  )
}
