import { ANIMATION_RATES, type AnimationFormat, type AnimationSettings } from '@/lib/plans/make-animation'
import type { TimeRange } from '@/lib/plans/trim'
import { RangeFields } from './RangeFields'
import { Segmented } from './ui/Segmented'
import { Toggle } from './ui/Toggle'

/** Make animation's settings (SPEC.md 6.8): the format (WebP only where `webp`, the browser can make
 * one), the range shared with Trim, the width (none above the video's), the frame rate and the loop
 * switch. */
export function AnimationView({
  duration,
  range,
  playhead,
  settings,
  widths,
  webp,
  onRange,
  onSeek,
  onChange,
}: {
  duration: number
  range: TimeRange
  playhead: number
  /** With the width the animation is really made at. */
  settings: AnimationSettings
  widths: { value: number; disabled: boolean }[]
  webp: boolean
  onRange: (range: TimeRange) => void
  onSeek: (time: number) => void
  onChange: (change: Partial<AnimationSettings>) => void
}) {
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Format</h3>
        <Segmented
          label="Format"
          value={settings.format}
          options={[
            { value: 'gif', label: 'GIF' },
            { value: 'webp', label: 'WebP', disabled: !webp },
          ]}
          onChange={(format: AnimationFormat) => onChange({ format })}
        />
      </section>

      <RangeFields duration={duration} range={range} playhead={playhead} onRange={onRange} onSeek={onSeek} />

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Width (px)</h3>
        <Segmented
          label="Width"
          value={String(settings.width)}
          options={widths.map((w) => ({ value: String(w.value), label: String(w.value), disabled: w.disabled }))}
          onChange={(w) => onChange({ width: Number(w) })}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Frame rate (fps)</h3>
        <Segmented
          label="Frame rate"
          value={String(settings.frameRate)}
          options={ANIMATION_RATES.map((r) => ({ value: String(r), label: String(r) }))}
          onChange={(r) => onChange({ frameRate: Number(r) as AnimationSettings['frameRate'] })}
        />
      </section>

      <Toggle
        label="Loop"
        hint="Plays again from the start, forever."
        checked={settings.loop}
        onChange={(loop) => onChange({ loop })}
      />
    </>
  )
}
