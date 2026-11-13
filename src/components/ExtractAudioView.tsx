import { RadioGroup } from 'radix-ui'
import type { MediaInfo } from '@/lib/info'
import {
  audioTrackLabel,
  audioTracks,
  type AudioFormat,
  type ExtractAudioSettings,
  type Mp3Bitrate,
} from '@/lib/plans/extract-audio'
import { Segmented } from './ui/Segmented'

const FORMATS: { value: AudioFormat; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: 'mp3', label: 'MP3' },
  { value: 'wav', label: 'WAV' },
  { value: 'flac', label: 'FLAC' },
]
const BITRATES: Mp3Bitrate[] = [128, 192, 256, 320]

/** Extract audio's settings (SPEC.md 6.2): which audio track, when there's more than one; the
 * format, with the formats this track can't be converted to disabled and the reasons said once
 * below; and the format's own option. */
export function ExtractAudioView({
  info,
  settings,
  problems,
  onChange,
}: {
  info: MediaInfo
  /** The track and format in effect. */
  settings: ExtractAudioSettings & { trackId: number }
  problems: Record<AudioFormat, string | null>
  onChange: (change: Partial<ExtractAudioSettings>) => void
}) {
  const tracks = audioTracks(info)
  const reasons = [...new Set(Object.values(problems).filter((p): p is string => !!p))]
  return (
    <>
      {tracks.length > 1 && (
        <section className="flex flex-col gap-2">
          <h3 id="audio-track-label" className="text-[13px] font-medium text-ink-soft">
            Audio track
          </h3>
          <RadioGroup.Root
            aria-labelledby="audio-track-label"
            value={String(settings.trackId)}
            onValueChange={(v) => onChange({ trackId: Number(v) })}
            className="flex flex-col gap-1"
          >
            {tracks.map((track, i) => (
              <label
                key={track.id}
                className="flex cursor-pointer items-center gap-2.5 rounded-control px-2 py-1.5 text-[13px] hover:bg-sunken"
              >
                <RadioGroup.Item
                  value={String(track.id)}
                  className="flex size-4 shrink-0 items-center justify-center rounded-full ring-1 ring-line-strong data-[state=checked]:ring-accent"
                >
                  <RadioGroup.Indicator className="size-2 rounded-full bg-accent" />
                </RadioGroup.Item>
                {audioTrackLabel(track, i + 1)}
              </label>
            ))}
          </RadioGroup.Root>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Format</h3>
        <Segmented
          label="Format"
          value={settings.format}
          options={FORMATS.map((f) => ({ ...f, disabled: !!problems[f.value] }))}
          onChange={(format) => onChange({ format })}
        />
        {reasons.map((r) => (
          <p key={r} className="text-xs text-ink-soft">
            {r}
          </p>
        ))}
      </section>

      {settings.format === 'mp3' && (
        <section className="flex flex-col gap-2">
          {/* The unit sits in the heading: "128 kbps" four times over doesn't fit the column. */}
          <h3 className="text-[13px] font-medium text-ink-soft">Bitrate (kbps)</h3>
          <Segmented
            label="Bitrate"
            value={String(settings.mp3Bitrate)}
            options={BITRATES.map((b) => ({ value: String(b), label: String(b), name: `${b} kbps` }))}
            onChange={(b) => onChange({ mp3Bitrate: Number(b) as Mp3Bitrate })}
          />
        </section>
      )}

      {settings.format === 'wav' && (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-medium text-ink-soft">Bit depth</h3>
          <Segmented
            label="Bit depth"
            value={String(settings.wavBits)}
            options={[
              { value: '16', label: '16-bit' },
              { value: '24', label: '24-bit' },
            ]}
            onChange={(b) => onChange({ wavBits: b === '24' ? 24 : 16 })}
          />
        </section>
      )}
    </>
  )
}
