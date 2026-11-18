import {
  bitsPerPixel,
  canCapFrameRate,
  canScaleTo,
  cappedFrameRate,
  MIN_BITS_PER_PIXEL,
  presetBitrate,
  scaledSize,
  targetVideoBitrate,
  type QualityPreset,
} from '../bitrate'
import { VIDEO_ENCODE_CODECS, type Capabilities, type VideoEncodeCodec } from '../capabilities'
import { destination, type ContainerCodecs, type OutputContainer } from '../containers'
import {
  CONTAINER_NAMES,
  codecName,
  formatBitrate,
  unnamedCodecHint,
  videoTrack,
  type AudioTrack,
  type MediaInfo,
  type Track,
} from '../info'
import { outputName } from '../names'
import type { Plan, Planned } from '../plan'

export type Resolution = 'original' | '1080' | '720' | '480'
export type FrameRateCap = 'original' | '30' | '24'
export type CompressAudio = 'keep' | 'smaller' | 'remove'

export type CompressSettings = {
  aim: 'quality' | 'size'
  preset: QualityPreset
  /** Target size in decimal MB (1 MB = 1,000,000 bytes). */
  targetMB: number
  resolution: Resolution
  frameRate: FrameRateCap
  codec: VideoEncodeCodec
  audio: CompressAudio
}

/** Everything but the target, which starts at half of each file (`defaultTargetMB`). */
export const DEFAULT_COMPRESS: Omit<CompressSettings, 'targetMB'> = {
  aim: 'quality',
  preset: 'balanced',
  resolution: 'original',
  frameRate: 'original',
  codec: 'avc',
  audio: 'keep',
}

export type Option<T> = { value: T; label: string; disabled: boolean }

const shorterSide = (r: Resolution) => (r === 'original' ? null : Number(r))
const RESOLUTIONS: Resolution[] = ['original', '1080', '720', '480']

/** Original, 1080p, 720p, 480p: the number is the shorter side, so portrait video works too; sizes
 * above the source are disabled, as nothing is scaled up. */
export function resolutionOptions(info: MediaInfo): Option<Resolution>[] {
  const video = videoTrack(info)
  return RESOLUTIONS.map((value) => ({
    value,
    label: value === 'original' ? 'Original' : `${value}p`,
    disabled: value !== 'original' && (!video || !canScaleTo(video.width, video.height, Number(value))),
  }))
}

/** Original, 30, 24; a cap that would raise the source's rate is disabled. */
export function frameRateOptions(info: MediaInfo): Option<FrameRateCap>[] {
  const rate = videoTrack(info)?.frameRate ?? null
  return (['original', '30', '24'] as const).map((value) => ({
    value,
    label: value === 'original' ? 'Original' : value,
    disabled: value !== 'original' && !canCapFrameRate(rate, Number(value)),
  }))
}

/** The size the video is encoded at, which is what the encoders are asked about. */
export function outputSize(info: MediaInfo, resolution: Resolution) {
  const video = videoTrack(info)
  return video ? scaledSize(video.width, video.height, shorterSide(resolution)) : { width: 0, height: 0 }
}

const CODEC_LABELS: Record<VideoEncodeCodec, string> = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' }
const CODEC_CAPTIONS: Record<VideoEncodeCodec, string> = {
  avc: 'Plays everywhere.',
  hevc: 'Smaller files. Plays on most phones and Macs, but not in every browser.',
  vp9: 'A WebM file. Plays in browsers, less widely elsewhere. Slow to make in some browsers.',
  av1: 'The smallest files, and the slowest to make. Plays on newer devices.',
}
// Where each codec goes: MP4 for all but VP9, which goes in WebM (SPEC.md 6.6).
const CONTAINER: Record<VideoEncodeCodec, OutputContainer> = { avc: 'mp4', hevc: 'mp4', vp9: 'webm', av1: 'mp4' }

/** The codecs, each enabled when this browser can encode it; `caps.encodeVideo` must be the answer
 * at the chosen size. */
export function codecOptions(caps: Capabilities): (Option<VideoEncodeCodec> & { caption: string })[] {
  return VIDEO_ENCODE_CODECS.map((value) => ({
    value,
    label: CODEC_LABELS[value],
    disabled: !caps.encodeVideo[value],
    caption: CODEC_CAPTIONS[value],
  }))
}

/** The settings in effect: a size or frame rate this file can't take (carried over from another file)
 * falls back to Original, and a codec this browser can't encode at this size to the first it can. */
export function effectiveCompress(info: MediaInfo, settings: CompressSettings, caps: Capabilities): CompressSettings {
  const usable = <T>(options: Option<T>[], value: T, fallback: T) =>
    options.find((o) => o.value === value && !o.disabled) ? value : fallback
  const resolution = usable(resolutionOptions(info), settings.resolution, 'original')
  const frameRate = usable(frameRateOptions(info), settings.frameRate, 'original')
  const codec = caps.encodeVideo[settings.codec]
    ? settings.codec
    : (VIDEO_ENCODE_CODECS.find((c) => caps.encodeVideo[c]) ?? settings.codec)
  return { ...settings, resolution, frameRate, codec }
}

const KEEP_BITRATE = 128_000
const SMALLER_BITRATE = 96_000
/** What copied audio of unknown bitrate is taken to use in the target-size sum. */
const ASSUMED_AUDIO_BITRATE = 128_000

/** Compress (SPEC.md 6.6): the video re-encoded, at a quality level or to fit a target size, maybe
 * smaller and at a lower frame rate; the audio copied, made smaller or removed. `caps.encodeVideo` is
 * what this browser can encode at the chosen size. */
export function planCompress(
  info: MediaInfo,
  chosen: CompressSettings,
  codecs: ContainerCodecs,
  caps: Capabilities,
): Planned {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!video.codec) return { problems: ['Moviola can’t tell which codec this video uses, so it can’t compress it.'] }
  if (!video.canDecode) {
    return { problems: [`This browser can’t decode ${codecName(video.codec, null)} video, so it can’t compress it.`] }
  }

  const settings = effectiveCompress(info, chosen, caps)
  const { width, height } = outputSize(info, settings.resolution)
  const { codec } = settings
  if (!caps.encodeVideo[codec]) return { problems: [`This browser can’t encode video at ${width} × ${height}.`] }

  const container = CONTAINER[codec]
  const containerName = CONTAINER_NAMES[container]
  const hints: string[] = []
  const unnamed = (t: Track) => {
    hints.push(unnamedCodecHint(t))
    return false
  }

  // Audio: every track with a codec Mediabunny can name, all copied or all encoded.
  const audio =
    settings.audio === 'remove'
      ? []
      : info.tracks.filter((t): t is AudioTrack => t.kind === 'audio' && (!!t.codec || unnamed(t)))
  // AAC in MP4, Opus in WebM, the usual pairs.
  const audioCodec = container === 'webm' ? 'opus' : 'aac'
  const copyAudio = settings.audio === 'keep' && audio.every((t) => codecs[container].includes(t.codec!))
  const encodeAudio = audio.length > 0 && !copyAudio
  if (encodeAudio) {
    const undecodable = audio.find((t) => !t.canDecode)
    if (undecodable) {
      const name = codecName(undecodable.codec, null)
      return {
        problems: [
          settings.audio === 'smaller'
            ? `This browser can’t decode ${name} audio, so it can’t be made smaller. Keep it or remove it.`
            : `${containerName} can’t hold ${name} audio, and this browser can’t decode it to convert it. Remove the audio or choose another codec.`,
        ],
      }
    }
    if (!caps.encodeAudio[audioCodec]) {
      return {
        problems: [
          `This browser can’t encode ${codecName(audioCodec, null)} audio, which ${containerName} needs. Remove the audio or choose another codec.`,
        ],
      }
    }
  }
  const audioBitrate = settings.audio === 'smaller' ? SMALLER_BITRATE : KEEP_BITRATE
  const stereo = audio.some((t) => t.channels > 2)

  // Subtitles go along when the container holds them.
  const subtitles = info.tracks.filter((t) => t.kind === 'subtitle' && (!!t.codec || unnamed(t)))
  const keptSubtitles = subtitles.filter((t) => codecs[container].includes(t.codec!))
  if (keptSubtitles.length < subtitles.length) hints.push('Subtitles aren’t carried over.')
  // Compress re-encodes one video track; any others (another angle, a cover picture) are left out.
  if (info.tracks.filter((t) => t.kind === 'video').length > 1) hints.push('Only the first video track is kept.')

  const frameRate = cappedFrameRate(
    video.frameRate,
    settings.frameRate === 'original' ? null : Number(settings.frameRate),
  )
  let bitrate: number
  if (settings.aim === 'quality') {
    // The preset's bitrate, given as a bitrate: left as a quality level, Mediabunny encodes at a fixed
    // quantizer, whose size depends on the picture (a noisy phone video at High grew by 63%). One that
    // would spend more bits than the source has would only make the file bigger, so it's capped.
    const preset = presetBitrate(codec, width, height, settings.preset)
    bitrate = video.bitrate && video.bitrate < preset ? Math.round(video.bitrate) : preset
    if (bitrate < preset) hints.unshift('This video is already compact; the result may not be much smaller.')
  } else {
    const target = settings.targetMB * 1_000_000
    const audioBits = encodeAudio
      ? audio.length * audioBitrate
      : audio.reduce((sum, t) => sum + (t.bitrate ?? ASSUMED_AUDIO_BITRATE), 0)
    bitrate = targetVideoBitrate(target, info.duration, audioBits)
    const outRate = frameRate ?? video.frameRate
    const fits = (w: number, h: number) => bitsPerPixel(bitrate, w, h, outRate) >= MIN_BITS_PER_PIXEL
    if (!fits(width, height)) {
      const current = Math.min(width, height)
      const smaller = RESOLUTIONS.filter((r) => r !== 'original' && Number(r) < current).find((r) => {
        const size = outputSize(info, r)
        return fits(size.width, size.height)
      })
      const suggestion = smaller ? `Try ${smaller}p or a larger size.` : 'Try a larger size.'
      return {
        problems: [
          `${settings.targetMB} MB is too small for ${durationWords(info.duration)} at ${current}p. ${suggestion}`,
        ],
      }
    }
    hints.push(`About ${formatBitrate(bitrate)} for the video.`)
    if (info.size <= target) hints.push(`The file is already smaller than ${settings.targetMB} MB.`)
  }

  const { extension, mimeType } = destination(container, 'video')
  const plan: Plan = {
    kind: 'video',
    container,
    name: outputName(info.name, ' (compressed)', extension),
    mimeType,
    lossless: false,
    keep: [video.id, ...audio.map((t) => t.id), ...keptSubtitles.map((t) => t.id)],
    video: {
      codec,
      bitrate,
      ...(settings.aim === 'size' && { constantBitrate: true }),
      width,
      height,
      ...(frameRate !== null && { frameRate }),
    },
    ...(encodeAudio && {
      audio: { codec: audioCodec, bitrate: audioBitrate, ...(stereo && { numberOfChannels: 2 }) },
    }),
    sizeCheck: { target: settings.aim === 'size' ? settings.targetMB * 1_000_000 : null },
  }

  const changes = [
    ...(width !== video.width || height !== video.height ? [`${width} × ${height}`] : []),
    ...(frameRate !== null ? [`${frameRate} fps`] : []),
  ]
  const videoPart = `Video re-encoded to ${CODEC_LABELS[codec]}${changes.length ? ` at ${changes.join(', ')}` : ''}`
  const audioPart = !info.tracks.some((t) => t.kind === 'audio')
    ? ''
    : settings.audio === 'remove'
      ? ', audio removed'
      : encodeAudio
        ? `, audio to ${stereo ? 'stereo ' : ''}${codecName(audioCodec, null)} at ${formatBitrate(audioBitrate)}`
        : ', audio copied'
  return { plan, caption: `${videoPart}${audioPart}.`, ...(hints.length && { hints }) }
}

/** "45 seconds", "1 minute 30 seconds", "13 minutes", "1 hour 5 minutes": seconds count under ten
 * minutes, and are rounded away above it. */
function durationWords(seconds: number): string {
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`
  const both = (a: number, aUnit: string, b: number, bUnit: string) =>
    `${plural(a, aUnit)}${b ? ` ${plural(b, bUnit)}` : ''}`
  const whole = Math.round(seconds)
  if (whole < 60) return plural(whole, 'second')
  if (whole < 600) return both(Math.floor(whole / 60), 'minute', whole % 60, 'second')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return plural(minutes, 'minute')
  return both(Math.floor(minutes / 60), 'hour', minutes % 60, 'minute')
}
