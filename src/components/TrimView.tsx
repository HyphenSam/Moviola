import type { TimeRange, TrimMode } from '@/lib/plans/trim'
import { RangeFields } from './RangeFields'
import { Segmented } from './ui/Segmented'

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
  return (
    <>
      <RangeFields duration={duration} range={range} playhead={playhead} onRange={onRange} onSeek={onSeek} />

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
