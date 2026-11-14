import { ChevronDown } from 'lucide-react'
import { useState } from 'react'
import type { QualityPreset } from '@/lib/bitrate'
import type { VideoEncodeCodec } from '@/lib/capabilities'
import { cn } from '@/lib/cn'
import type { CompressAudio, CompressSettings, FrameRateCap, Option, Resolution } from '@/lib/plans/compress'
import { Button } from './ui/Button'
import { NumberInput } from './ui/NumberInput'
import { Segmented } from './ui/Segmented'

const QUICK_PICKS = [8, 10, 25, 50]
const AUDIO_CAPTIONS: Record<CompressAudio, string> = {
  keep: 'Copied when the new file can hold it; otherwise converted at 128 kbps.',
  smaller: 'Converted at 96 kbps.',
  remove: 'The result has no sound.',
}

/** Compress's settings (SPEC.md 6.6): the aim (a quality preset or a target size), the resolution,
 * the audio, and behind "More options" the frame rate and the codec, with the codecs this browser
 * can't encode at the chosen size disabled and named. */
export function CompressView({
  settings,
  resolutions,
  frameRates,
  codecs,
  hasAudio,
  onChange,
}: {
  /** The settings in effect. */
  settings: CompressSettings
  resolutions: Option<Resolution>[]
  frameRates: Option<FrameRateCap>[]
  codecs: (Option<VideoEncodeCodec> & { caption: string })[]
  hasAudio: boolean
  onChange: (change: Partial<CompressSettings>) => void
}) {
  const [more, setMore] = useState(false)
  const missing = codecs.filter((c) => c.disabled).map((c) => c.label)
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Aim</h3>
        <Segmented
          label="Aim"
          value={settings.aim}
          options={[
            { value: 'quality', label: 'Quality' },
            { value: 'size', label: 'Target size' },
          ]}
          onChange={(aim) => onChange({ aim })}
        />
        {settings.aim === 'quality' ? (
          <Segmented<QualityPreset>
            label="Quality"
            value={settings.preset}
            options={[
              { value: 'smaller', label: 'Smaller' },
              { value: 'balanced', label: 'Balanced' },
              { value: 'high', label: 'High' },
            ]}
            onChange={(preset) => onChange({ preset })}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <NumberInput
              label="Target size"
              value={settings.targetMB}
              min={1}
              max={100_000}
              unit="MB"
              onChange={(targetMB) => onChange({ targetMB })}
              className="w-24"
            />
            {QUICK_PICKS.map((mb) => (
              <Button
                key={mb}
                size="sm"
                variant="ghost"
                aria-label={`${mb} MB`}
                aria-pressed={settings.targetMB === mb}
                className="px-2 aria-pressed:bg-sunken aria-pressed:text-ink"
                onClick={() => onChange({ targetMB: mb })}
              >
                {mb}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Resolution</h3>
        <Segmented
          label="Resolution"
          value={settings.resolution}
          options={resolutions}
          onChange={(resolution) => onChange({ resolution })}
        />
      </section>

      {hasAudio && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink-soft">Audio</h3>
          <Segmented<CompressAudio>
            label="Audio"
            value={settings.audio}
            options={[
              { value: 'keep', label: 'Keep' },
              { value: 'smaller', label: 'Smaller' },
              { value: 'remove', label: 'Remove' },
            ]}
            onChange={(audio) => onChange({ audio })}
          />
          <p className="text-xs text-ink-soft">{AUDIO_CAPTIONS[settings.audio]}</p>
        </section>
      )}

      <section className="flex flex-col gap-4">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={more}
          className="-ml-2.5 self-start"
          onClick={() => setMore((m) => !m)}
        >
          More options
          <ChevronDown aria-hidden="true" className={cn('transition-transform duration-150', more && 'rotate-180')} />
        </Button>
        {more && (
          <>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-ink-soft">Frame rate</h3>
              <Segmented
                label="Frame rate"
                value={settings.frameRate}
                options={frameRates}
                onChange={(frameRate) => onChange({ frameRate })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-[13px] font-medium text-ink-soft">Codec</h3>
              <Segmented
                label="Codec"
                value={settings.codec}
                options={codecs}
                onChange={(codec) => onChange({ codec })}
              />
              <p className="text-xs text-ink-soft">{codecs.find((c) => c.value === settings.codec)?.caption}</p>
              {missing.length > 0 && (
                <p className="text-xs text-ink-soft">Not available in this browser: {missing.join(', ')}.</p>
              )}
            </div>
          </>
        )}
      </section>
    </>
  )
}
