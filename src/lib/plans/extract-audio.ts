import { losslessAudioContainer, type ContainerCodecs } from '../containers'
import { audioSummary, codecName, languageName, type AudioTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { Planned } from '../plan'

/** `trackId` null means the default track. Formats other than Original arrive in phase 4. */
export type ExtractAudioSettings = { trackId: number | null }

export const audioTracks = (info: MediaInfo) => info.tracks.filter((t): t is AudioTrack => t.kind === 'audio')

/** The track the file marks as default, else the first. */
export function defaultAudioTrack(info: MediaInfo): AudioTrack | null {
  const tracks = audioTracks(info)
  return tracks.find((t) => t.isDefault) ?? tracks[0] ?? null
}

/** "French · AC-3 · 5.1" for the track list; `n` counts audio tracks from 1. */
export function audioTrackLabel(track: AudioTrack, n: number): string {
  return [
    languageName(track.language) ?? `Track ${n}`,
    track.name,
    codecName(track.codec, null),
    audioSummary(track.sampleRate, track.channels).split(', ')[1],
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Extract audio, Original (SPEC.md 6.2): copy one audio track, untouched, into the container that
 * fits its codec. */
export function planExtractAudio(info: MediaInfo, settings: ExtractAudioSettings, codecs: ContainerCodecs): Planned {
  const tracks = audioTracks(info)
  const track = tracks.find((t) => t.id === settings.trackId) ?? defaultAudioTrack(info)
  if (!track) return { problems: ['This file has no audio track.'] }
  if (!track.codec) return { problems: ['Moviola can’t tell which codec this audio track uses, so it can’t copy it.'] }

  const codec = codecName(track.codec, null)
  const destination = losslessAudioContainer(track.codec, codecs)
  if (!destination) return { problems: [`Moviola can’t write ${codec} audio into any file type it knows.`] }

  const index = tracks.indexOf(track)
  return {
    plan: {
      kind: 'audio',
      container: destination.container,
      name: outputName(info.name, index > 0 ? ` (track ${index + 1})` : '', destination.extension),
      mimeType: destination.mimeType,
      lossless: true,
      keep: [track.id],
    },
    caption: `${codec}, copied as is into .${destination.extension}. No quality is lost.`,
  }
}
