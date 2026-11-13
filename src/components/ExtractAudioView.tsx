import { RadioGroup } from 'radix-ui'
import type { MediaInfo } from '@/lib/info'
import { audioTrackLabel, audioTracks } from '@/lib/plans/extract-audio'

/** Extract audio's settings (SPEC.md 6.2): which audio track, when there's more than one. */
export function ExtractAudioView({
  info,
  trackId,
  onTrackChange,
}: {
  info: MediaInfo
  trackId: number
  onTrackChange: (id: number) => void
}) {
  const tracks = audioTracks(info)
  if (tracks.length < 2) return <p className="text-[13px] text-ink-soft">Gets the sound out of the file as it is.</p>
  return (
    <section className="flex flex-col gap-2">
      <h3 id="audio-track-label" className="text-[13px] font-medium text-ink-soft">
        Audio track
      </h3>
      <RadioGroup.Root
        aria-labelledby="audio-track-label"
        value={String(trackId)}
        onValueChange={(v) => onTrackChange(Number(v))}
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
  )
}
