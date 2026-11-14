import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { FrameFormat } from '@/lib/plans/grab-frame'
import { formatTimecode } from '@/lib/timecode'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'

/** Grab frame's settings (SPEC.md 6.7): the playhead's time, which is the frame saved, with frame
 * steps beside it; the format; and what came of the last copy to the clipboard. */
export function GrabFrameView({
  duration,
  playhead,
  format,
  copyNote,
  onStep,
  onFormat,
}: {
  duration: number
  playhead: number
  format: FrameFormat
  copyNote: string | null
  onStep: (frames: number) => void
  onFormat: (format: FrameFormat) => void
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Frame at the playhead</h3>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous frame" onClick={() => onStep(-1)}>
            <ChevronLeft />
          </Button>
          <span className="px-1 font-mono text-[13px] font-medium">
            {formatTimecode(playhead, { hours: duration >= 3600 })}
          </span>
          <Button variant="ghost" size="sm" aria-label="Next frame" onClick={() => onStep(1)}>
            <ChevronRight />
          </Button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Format</h3>
        <Segmented
          label="Format"
          value={format}
          options={[
            { value: 'png', label: 'PNG' },
            { value: 'jpeg', label: 'JPEG' },
          ]}
          onChange={onFormat}
        />
        <p className="text-xs text-ink-soft">
          {format === 'png' ? 'Every pixel as decoded.' : 'A smaller file, at quality 90.'}
        </p>
      </section>

      <p role="status" className="text-xs text-ink-soft empty:hidden">
        {copyNote}
      </p>
    </>
  )
}
