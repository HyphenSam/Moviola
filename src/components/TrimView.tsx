import { LocateFixed } from 'lucide-react'
import type { TimeRange, TrimMode } from '@/lib/plans/trim'
import { formatTimecode } from '@/lib/timecode'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { TimecodeField } from './ui/TimecodeField'

/** Trim's settings (SPEC.md 6.3): the in and out points, each settable from the playhead, the length,
 * and for video the mode, with Precise disabled and the reason given when it can't run, and where a
 * fast trim really starts. */
export function TrimView({
  duration,
  range,
  playhead,
  video,
  mode,
  preciseProblem,
  keyframeNote,
  onRange,
  onSeek,
  onMode,
}: {
  duration: number
  range: TimeRange
  playhead: number
  /** Whether the file has video; audio has no mode to choose. */
  video: boolean
  mode: TrimMode
  preciseProblem: string | null
  keyframeNote: string | null
  onRange: (range: TimeRange) => void
  onSeek: (time: number) => void
  onMode: (mode: TrimMode) => void
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
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Range</h3>
        {point('start', 'In')}
        {point('end', 'Out')}
        <p className="text-xs text-ink-soft">
          Length {formatTimecode(Math.max(0, range.end - range.start), { hours })}
        </p>
      </section>

      {video && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink-soft">Mode</h3>
          <Segmented
            label="Mode"
            value={mode}
            options={[
              { value: 'fast', label: 'Fast' },
              { value: 'precise', label: 'Precise', disabled: !!preciseProblem },
            ]}
            onChange={onMode}
          />
          <p className="text-xs text-ink-soft">
            {mode === 'fast'
              ? 'Cuts without re-encoding, so the video starts on a keyframe.'
              : 'Re-encodes the video so it starts on the exact frame.'}
          </p>
          {preciseProblem && <p className="text-xs text-ink-soft">{preciseProblem}</p>}
          {mode === 'fast' && keyframeNote && <p className="text-xs text-ink">{keyframeNote}</p>}
        </section>
      )}
    </>
  )
}
