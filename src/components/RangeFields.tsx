import { LocateFixed } from 'lucide-react'
import type { TimeRange } from '@/lib/plans/trim'
import { formatTimecode } from '@/lib/timecode'
import { Button } from './ui/Button'
import { TimecodeField } from './ui/TimecodeField'

/** The range tools' in and out points (Trim, Make animation), each typed or set from the playhead, and the
 * resulting length. Typing a point moves the playhead there, so the frame can be judged. */
export function RangeFields({
  duration,
  range,
  playhead,
  onRange,
  onSeek,
}: {
  duration: number
  range: TimeRange
  playhead: number
  onRange: (range: TimeRange) => void
  onSeek: (time: number) => void
}) {
  const hours = duration >= 3600
  const point = (end: 'start' | 'end', label: string) => (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[13px] font-medium">{label}</span>
      <TimecodeField
        label={label}
        value={range[end]}
        max={duration}
        onChange={(t) => {
          onRange({ ...range, [end]: t })
          onSeek(t)
        }}
      />
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Set ${label.toLowerCase()} to playhead`}
        title="Set to playhead"
        onClick={() => onRange({ ...range, [end]: playhead })}
      >
        <LocateFixed />
      </Button>
    </div>
  )

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[13px] font-medium text-ink-soft">Range</h3>
      {point('start', 'In')}
      {point('end', 'Out')}
      <p className="text-xs text-ink-soft">Length {formatTimecode(Math.max(0, range.end - range.start), { hours })}</p>
    </section>
  )
}
