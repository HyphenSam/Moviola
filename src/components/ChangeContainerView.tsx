import { CONTAINER_NAMES, type MediaInfo } from '@/lib/info'
import { CONTAINER_CHOICES, type ContainerChoice, type TrackRow } from '@/lib/plans/change-container'
import { Checkbox } from './ui/Checkbox'
import { Segmented } from './ui/Segmented'

/** Change container's settings (SPEC.md 6.4): the container, the source's own disabled; every track
 * with a checkbox, those the container can't hold unticked, disabled and saying why; and, for MKV,
 * the note about subtitles Moviola can't read. */
export function ChangeContainerView({
  info,
  container,
  tracks,
  dropped,
  note,
  onContainer,
  onTrack,
}: {
  info: MediaInfo
  container: ContainerChoice
  tracks: TrackRow[]
  /** The tracks the user unticked. */
  dropped: readonly number[]
  note: string | null
  onContainer: (container: ContainerChoice) => void
  onTrack: (id: number, keep: boolean) => void
}) {
  const own = (CONTAINER_CHOICES as string[]).includes(info.container)
  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-medium text-ink-soft">Container</h3>
        <Segmented
          label="Container"
          value={container}
          options={CONTAINER_CHOICES.map((c) => ({
            value: c,
            label: CONTAINER_NAMES[c],
            disabled: c === info.container,
          }))}
          onChange={onContainer}
        />
        {own && <p className="text-xs text-ink-soft">Already {CONTAINER_NAMES[info.container]}.</p>}
      </section>

      <section className="flex flex-col gap-1">
        <h3 className="mb-1 text-[13px] font-medium text-ink-soft">Tracks</h3>
        {tracks.map(({ track, label, reason }) => (
          <Checkbox
            key={track.id}
            label={label}
            hint={reason}
            checked={!reason && !dropped.includes(track.id)}
            disabled={!!reason}
            onChange={(keep) => onTrack(track.id, keep)}
          />
        ))}
        {note && <p className="mt-1 px-2 text-xs text-ink-soft">{note}</p>}
      </section>
    </>
  )
}
