import { VIDEO_ENCODE_CODECS } from '../capabilities'
import { destination, type ContainerCodecs } from '../containers'
import { codecName, CONTAINER_NAMES, hasVideo, languageName, type MediaInfo, type Track } from '../info'
import { outputName } from '../names'
import type { Plan, Planned } from '../plan'

/** The containers Change container offers. */
export type ContainerChoice = 'mp4' | 'mov' | 'mkv' | 'webm'
export const CONTAINER_CHOICES: ContainerChoice[] = ['mp4', 'mov', 'mkv', 'webm']

/** MP4 plays nearly everywhere; a file that's already MP4 goes to MKV, which holds nearly anything. */
export const defaultContainer = (info: MediaInfo): ContainerChoice => (info.container === 'mp4' ? 'mkv' : 'mp4')

/** A track as the list shows it, and why the chosen container can't take it (null when it can). */
export type TrackRow = { track: Track; label: string; reason: string | null }

const KINDS = { video: 'Video', audio: 'Audio', subtitle: 'Subtitles' }

export function containerTracks(info: MediaInfo, container: ContainerChoice, codecs: ContainerCodecs): TrackRow[] {
  return info.tracks.map((track) => ({
    track,
    label: [KINDS[track.kind], codecName(track.codec, null), languageName(track.language), track.name]
      .filter(Boolean)
      .join(' · '),
    reason: !track.codec
      ? 'Moviola can’t tell which codec this track uses.'
      : codecs[container].includes(track.codec)
        ? null
        : `${CONTAINER_NAMES[container]} can’t hold ${codecName(track.codec, null)}.`,
  }))
}

/** Mediabunny reads no subtitles but WebVTT, so an MKV's usual SRT or ASS tracks aren't in the list
 * at all; say so once, where they'd be missed. */
export const subtitleNote = (info: MediaInfo) =>
  info.container === 'mkv' ? 'Subtitles other than WebVTT aren’t carried over.' : null

const orList = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(', ')} or ${words.at(-1)}` : (words[0] ?? '')

/** Change container (SPEC.md 6.4): the ticked tracks the chosen container holds, copied as is.
 * `dropped` lists the tracks the user unticked. */
export function planChangeContainer(
  info: MediaInfo,
  container: ContainerChoice,
  dropped: readonly number[],
  codecs: ContainerCodecs,
): Planned {
  const into = CONTAINER_NAMES[container]
  if (!hasVideo(info)) return { problems: ['This file has no video.'] }
  if (info.container === container) return { problems: [`It’s already ${into}.`] }

  const rows = containerTracks(info, container, codecs)
  // The video must survive the move; unticking it on purpose is the user's choice.
  const video = rows.find((r) => r.track.kind === 'video')!
  if (video.reason) {
    if (!video.track.codec)
      return { problems: ['Moviola can’t tell which codec this video uses, so it can’t copy it.'] }
    const to = orList(VIDEO_ENCODE_CODECS.filter((c) => codecs[container].includes(c)).map((c) => codecName(c, null)))
    const way = to ? ` Use Compress to convert it to ${to}.` : ''
    return { problems: [`${into} can’t hold this video’s ${codecName(video.track.codec, null)}.${way}`] }
  }

  const kept = rows.filter((r) => !r.reason && !dropped.includes(r.track.id)).map((r) => r.track)
  if (!kept.length) return { problems: ['Tick at least one track to keep.'] }

  const kind = kept.some((t) => t.kind === 'video') ? 'video' : 'audio'
  const { extension, mimeType } = destination(container, kind)
  const plan: Plan = {
    kind,
    container,
    name: outputName(info.name, '', extension),
    mimeType,
    lossless: true,
    keep: kept.map((t) => t.id),
  }
  return { plan, caption: 'Every ticked track copied as is. No quality is lost.' }
}
