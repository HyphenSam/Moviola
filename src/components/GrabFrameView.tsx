import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { FrameFormat, FrameSettings } from '@/lib/plans/grab-frame'
import { formatTimecode } from '@/lib/timecode'
import { Button } from './ui/Button'
import { Segmented } from './ui/Segmented'
import { Toggle } from './ui/Toggle'

const ABOUT = {
  png: 'Every pixel as decoded.',
  jpeg: 'A smaller file, at quality 90.',
  webp: 'A smaller file, at quality 90.',
  'webp-lossless': 'Every pixel as decoded, in a smaller file than PNG.',
}

/** Grab frame's settings (SPEC.md 6.7): the playhead's time, which is the frame saved, with frame
 * steps beside it; the format, with WebP's lossless switch (WebP only where `webp`, the browser can
 * make one); and what came of the last copy to the clipboard. */
export function GrabFrameView({
  duration,
  playhead,
  settings,
  webp,
  copyNote,
  onStep,
  onChange,
}: {
  duration: number
  playhead: number
  settings: FrameSettings
  webp: boolean
  copyNote: string | null
  onStep: (frames: number) => void
  onChange: (change: Partial<FrameSettings>) => void
}) {
  const { format, lossless } = settings
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
            { value: 'webp', label: 'WebP', disabled: !webp },
          ]}
          onChange={(f: FrameFormat) => onChange({ format: f })}
        />
        <p className="text-xs text-ink-soft">{ABOUT[format === 'webp' && lossless ? 'webp-lossless' : format]}</p>
      </section>

      {format === 'webp' && <Toggle label="Lossless" checked={lossless} onChange={(l) => onChange({ lossless: l })} />}

      <p role="status" className="text-xs text-ink-soft empty:hidden">
        {copyNote}
      </p>
    </>
  )
}
