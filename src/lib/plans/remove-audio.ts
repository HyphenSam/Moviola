import { destination, type ContainerCodecs, type OutputContainer } from '../containers'
import { hasAudio, videoTrack, type MediaInfo, type Track } from '../info'
import { extensionOf, outputName } from '../names'
import type { Plan, Planned } from '../plan'

/** Remove audio (SPEC.md 6.5): everything but the audio copied as is, apart from the audio tracks the
 * user ticked to keep (`keepAudio`). Subtitles stay. */
export function planRemoveAudio(info: MediaInfo, keepAudio: readonly number[], codecs: ContainerCodecs): Planned {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!hasAudio(info)) return { problems: ['This file has no audio track.'] }
  if (!video.codec) return { problems: ['Moviola can’t tell which codec this video uses, so it can’t copy it.'] }

  const audio = info.tracks.filter((t) => t.kind === 'audio')
  if (audio.every((t) => keepAudio.includes(t.id))) {
    return { problems: ['Every audio track is ticked, so nothing would be removed.'] }
  }

  const wanted = info.tracks.filter((t) => t.kind !== 'audio' || keepAudio.includes(t.id))
  // A track whose codec Mediabunny can't name can't be copied; the rest still can.
  const kept = wanted.filter((t) => t.codec)
  const hints = wanted
    .filter((t) => !t.codec)
    .map((t) => `Moviola can’t tell which codec ${article(t)} track uses, so it’s left out.`)

  // The source's own container when it holds what's kept, else MKV, as Trim does.
  const holdsAll = (c: OutputContainer) => kept.every((t) => codecs[c].includes(t.codec!))
  const container = [info.container, 'mkv' as const].find(holdsAll)
  if (!container) return { problems: ['Moviola can’t write these tracks into any file type it knows.'] }

  const { extension, mimeType } = destination(container, 'video')
  const edited = kept.some((t) => t.kind === 'audio')
  const own = container === info.container ? extensionOf(info.name) : null
  const plan: Plan = {
    kind: 'video',
    container,
    name: outputName(info.name, edited ? ' (edited)' : ' (no audio)', own ?? extension),
    mimeType,
    lossless: true,
    keep: kept.map((t) => t.id),
  }
  const caption = edited
    ? 'Video and the ticked audio copied as is. No quality is lost.'
    : 'Video copied as is, without its audio. No quality is lost.'
  return { plan, caption, ...(hints.length && { hints }) }
}

const article = (t: Track) => (t.kind === 'audio' ? 'an audio' : `a ${t.kind}`)
