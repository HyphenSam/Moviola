import type { MediaCodec } from 'mediabunny'

/** The containers Moviola writes. */
export type OutputContainer = 'mp4' | 'mov' | 'mkv' | 'webm' | 'mpegts' | 'ogg' | 'mp3' | 'flac' | 'wav' | 'adts'

/** Which codecs each container can hold. Mediabunny knows (`src/media/formats.ts` asks it); the
 * planners get it as plain data so they never import Mediabunny's runtime. */
export type ContainerCodecs = Record<OutputContainer, readonly MediaCodec[]>

export type Destination = { container: OutputContainer; extension: string; mimeType: string }

const M4A: Destination = { container: 'mp4', extension: 'm4a', mimeType: 'audio/mp4' }
const OPUS: Destination = { container: 'ogg', extension: 'opus', mimeType: 'audio/ogg' }
const OGG: Destination = { container: 'ogg', extension: 'ogg', mimeType: 'audio/ogg' }
const MP3: Destination = { container: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg' }
const FLAC: Destination = { container: 'flac', extension: 'flac', mimeType: 'audio/flac' }
const WAV: Destination = { container: 'wav', extension: 'wav', mimeType: 'audio/wav' }
const MKA: Destination = { container: 'mkv', extension: 'mka', mimeType: 'audio/x-matroska' }
const MOV: Destination = { container: 'mov', extension: 'mov', mimeType: 'video/quicktime' }

// The usual home for each codec's audio on its own (SPEC.md 6.2). PCM goes to WAV when WAV holds that
// kind of PCM; everything else falls through to Matroska audio, then MOV.
const PREFERRED: Partial<Record<MediaCodec, Destination>> = { aac: M4A, opus: OPUS, vorbis: OGG, mp3: MP3, flac: FLAC }

/** Where a copied audio track goes without re-encoding: the container that fits its codec, or null
 * if no container Moviola writes can hold it. */
export function losslessAudioContainer(codec: MediaCodec, codecs: ContainerCodecs): Destination | null {
  const candidates = [PREFERRED[codec], WAV, MKA, MOV].filter((d): d is Destination => !!d)
  return candidates.find((d) => codecs[d.container].includes(codec)) ?? null
}

// Each container's usual extension and MIME type: for video, then for audio on its own.
const FILES: Record<OutputContainer, [video: Omit<Destination, 'container'>, audio?: Omit<Destination, 'container'>]> =
  {
    mp4: [
      { extension: 'mp4', mimeType: 'video/mp4' },
      { extension: 'm4a', mimeType: 'audio/mp4' },
    ],
    mov: [{ extension: 'mov', mimeType: 'video/quicktime' }],
    mkv: [
      { extension: 'mkv', mimeType: 'video/x-matroska' },
      { extension: 'mka', mimeType: 'audio/x-matroska' },
    ],
    webm: [
      { extension: 'webm', mimeType: 'video/webm' },
      { extension: 'webm', mimeType: 'audio/webm' },
    ],
    mpegts: [{ extension: 'ts', mimeType: 'video/mp2t' }],
    ogg: [{ extension: 'ogg', mimeType: 'audio/ogg' }],
    mp3: [{ extension: 'mp3', mimeType: 'audio/mpeg' }],
    flac: [{ extension: 'flac', mimeType: 'audio/flac' }],
    wav: [{ extension: 'wav', mimeType: 'audio/wav' }],
    adts: [{ extension: 'aac', mimeType: 'audio/aac' }],
  }

/** Where a result of this kind goes in `container`, with the container's usual extension. Ogg's
 * depends on what it holds, so pass the audio's codec where it's known: Opus is `.opus`. */
export function destination(container: OutputContainer, kind: 'video' | 'audio', codec?: string | null): Destination {
  if (container === 'ogg' && codec === 'opus') return OPUS
  const [video, audio] = FILES[container]
  return { container, ...(kind === 'audio' && audio ? audio : video) }
}
