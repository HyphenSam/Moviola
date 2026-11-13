import type { Capabilities } from '../capabilities'
import { losslessAudioContainer, type ContainerCodecs, type Destination } from '../containers'
import { audioSummary, codecName, languageName, type AudioTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { AudioEncodeTarget, Plan, Planned } from '../plan'

export type AudioFormat = 'original' | 'mp3' | 'wav' | 'flac'
export type Mp3Bitrate = 128 | 192 | 256 | 320

/** `trackId` null means the default track. The MP3 bitrate and WAV depth apply to their own formats. */
export type ExtractAudioSettings = {
  trackId: number | null
  format: AudioFormat
  mp3Bitrate: Mp3Bitrate
  wavBits: 16 | 24
}

export const DEFAULT_EXTRACT_AUDIO: ExtractAudioSettings = {
  trackId: null,
  format: 'original',
  mp3Bitrate: 192,
  wavBits: 16,
}

export const audioTracks = (info: MediaInfo) => info.tracks.filter((t): t is AudioTrack => t.kind === 'audio')

/** The track the file marks as default, else the first. */
export function defaultAudioTrack(info: MediaInfo): AudioTrack | null {
  const tracks = audioTracks(info)
  return tracks.find((t) => t.isDefault) ?? tracks[0] ?? null
}

const chosenTrack = (info: MediaInfo, trackId: number | null) =>
  audioTracks(info).find((t) => t.id === trackId) ?? defaultAudioTrack(info)

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

/** Why each format can't be used for the chosen track in this browser, or null where it can.
 * Converting needs the track decoded, and MP3 and FLAC need an encoder; WAV is written by Mediabunny. */
export function formatProblems(
  info: MediaInfo,
  trackId: number | null,
  caps: Capabilities,
): Record<AudioFormat, string | null> {
  const track = chosenTrack(info, trackId)
  const undecodable =
    track && !track.canDecode
      ? `This browser can’t decode ${codecName(track.codec, null)}. Original still works.`
      : null
  return {
    original: null,
    mp3: undecodable ?? (caps.encodeAudio.mp3 ? null : 'This browser can’t encode MP3.'),
    wav: undecodable,
    flac: undecodable ?? (caps.encodeAudio.flac ? null : 'This browser can’t encode FLAC.'),
  }
}

// PCM in any form, and FLAC, hold every sample exactly, so decoding them loses nothing.
const isLossless = (codec: string) =>
  codec === 'flac' || codec.startsWith('pcm-') || codec === 'ulaw' || codec === 'alaw'

/** MP3 reaches 320 kbps only at 32, 44.1 and 48 kHz (lower rates top out at 160 kbps or less, and
 * higher ones it can't hold), so other rates go to the nearest of those families. */
function mp3SampleRate(rate: number): number | undefined {
  if ([32000, 44100, 48000].includes(rate)) return undefined
  return rate % 11025 === 0 ? 44100 : 48000
}

const MP3: Destination = { container: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg' }
const WAV: Destination = { container: 'wav', extension: 'wav', mimeType: 'audio/wav' }
const FLAC: Destination = { container: 'flac', extension: 'flac', mimeType: 'audio/flac' }

/** Extract audio (SPEC.md 6.2): one audio track, copied untouched into the container that fits its
 * codec (Original), or converted to MP3, WAV or FLAC. */
export function planExtractAudio(
  info: MediaInfo,
  settings: ExtractAudioSettings,
  codecs: ContainerCodecs,
  caps: Capabilities,
): Planned {
  const tracks = audioTracks(info)
  const track = chosenTrack(info, settings.trackId)
  if (!track) return { problems: ['This file has no audio track.'] }
  if (!track.codec) return { problems: ['Moviola can’t tell which codec this audio track uses, so it can’t copy it.'] }

  const codec = codecName(track.codec, null)
  const index = tracks.indexOf(track)
  const planFor = (destination: Destination, lossless: boolean, audio?: Plan['audio']): Plan => ({
    kind: 'audio',
    container: destination.container,
    name: outputName(info.name, index > 0 ? ` (track ${index + 1})` : '', destination.extension),
    mimeType: destination.mimeType,
    lossless,
    keep: [track.id],
    ...(audio && { audio }),
  })

  const { format } = settings
  if (format === 'original') {
    const destination = losslessAudioContainer(track.codec, codecs)
    if (!destination) return { problems: [`Moviola can’t write ${codec} audio into any file type it knows.`] }
    return {
      plan: planFor(destination, true),
      caption: `${codec}, copied as is into .${destination.extension}. No quality is lost.`,
    }
  }

  const problem = formatProblems(info, track.id, caps)[format]
  if (problem) return { problems: [problem] }

  if (format === 'mp3') {
    const sampleRate = mp3SampleRate(track.sampleRate)
    return {
      plan: planFor(MP3, false, {
        codec: 'mp3',
        bitrate: settings.mp3Bitrate * 1000,
        numberOfChannels: Math.min(track.channels, 2),
        ...(sampleRate && { sampleRate }),
      }),
      caption: `${codec} re-encoded to MP3 at ${settings.mp3Bitrate} kbps${sampleRate ? `, resampled to ${sampleRate / 1000} kHz` : ''}.`,
      ...(track.codec === 'mp3' && { hints: ['Already MP3: Original keeps it without loss.'] }),
    }
  }

  // WAV and FLAC store every sample they're given; whether that's lossless depends on the source.
  const lossless = isLossless(track.codec)
  const [destination, target, name, done]: [Destination, AudioEncodeTarget, string, string] =
    format === 'wav'
      ? [WAV, settings.wavBits === 24 ? 'pcm-s24' : 'pcm-s16', 'WAV', `decoded to ${settings.wavBits}-bit WAV`]
      : [FLAC, 'flac', 'FLAC', 'compressed into FLAC']
  if (lossless)
    return { plan: planFor(destination, true, { codec: target }), caption: `${codec}, ${done}. No quality is lost.` }
  return {
    plan: planFor(destination, false, { codec: target }),
    caption: `${name} is ${format === 'wav' ? 'uncompressed' : 'lossless'}, but it can’t restore what the original codec already lost.`,
    badge: `Decodes to ${name}`,
  }
}
