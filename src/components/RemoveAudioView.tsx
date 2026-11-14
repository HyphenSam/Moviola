import type { MediaInfo } from '@/lib/info'
import { audioTrackLabel, audioTracks } from '@/lib/plans/extract-audio'
import { Checkbox } from './ui/Checkbox'

/** Remove audio's settings (SPEC.md 6.5): nothing to choose for one audio track; for several, a Keep
 * checkbox each, all unticked, so the default still removes all the audio. */
export function RemoveAudioView({
  info,
  keep,
  onKeep,
}: {
  info: MediaInfo
  /** The audio tracks the user ticked to keep. */
  keep: readonly number[]
  onKeep: (id: number, keep: boolean) => void
}) {
  const tracks = audioTracks(info)
  if (tracks.length < 2) {
    return <p className="text-xs text-ink-soft">Copies the video without its audio. Nothing is re-encoded.</p>
  }
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-[13px] font-medium text-ink-soft">Keep audio tracks</h3>
      <p className="mb-1 text-xs text-ink-soft">Unticked tracks are removed. Nothing is re-encoded.</p>
      {tracks.map((track, i) => {
        const label = audioTrackLabel(track, i + 1)
        return (
          <Checkbox
            key={track.id}
            label={label}
            name={`Keep ${label}`}
            checked={keep.includes(track.id)}
            onChange={(k) => onKeep(track.id, k)}
          />
        )
      })}
    </section>
  )
}
