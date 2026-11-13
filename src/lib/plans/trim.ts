import type { Capabilities, VideoEncodeCodec } from '../capabilities'
import { destination, type ContainerCodecs, type OutputContainer } from '../containers'
import { codecName, hasAudio, videoTrack, type MediaInfo, type Track } from '../info'
import { outputName, stem } from '../names'
import type { Plan, Planned } from '../plan'
import { formatTimecode, frameDuration } from '../timecode'

/** A range on the playhead's clock (0 is MediaInfo `start`), shared by Trim and Make GIF. */
export type TimeRange = { start: number; end: number }

export type TrimMode = 'fast' | 'precise'

/** The whole file, Trim's range until the user picks one. */
export const wholeFile = (info: MediaInfo): TimeRange => ({ start: 0, end: info.duration })

const ENCODABLE: readonly string[] = ['avc', 'hevc', 'vp9', 'av1'] satisfies VideoEncodeCodec[]

/** The codec Precise re-encodes to: the source's when the browser can encode it, else H.264. */
function preciseCodec(codec: string | null, caps: Capabilities): VideoEncodeCodec | null {
  if (codec && ENCODABLE.includes(codec) && caps.encodeVideo[codec as VideoEncodeCodec])
    return codec as VideoEncodeCodec
  return caps.encodeVideo.avc ? 'avc' : null
}

/** Why Precise can't be used for this file in this browser, or null where it can (and for audio,
 * which has no Precise). */
export function preciseProblem(info: MediaInfo, caps: Capabilities): string | null {
  const video = videoTrack(info)
  if (!video) return null
  if (!video.canDecode) return `This browser can’t decode ${codecName(video.codec, null)}. Fast still works.`
  if (preciseCodec(video.codec, caps)) return null
  const tried = video.codec === 'avc' || !video.codec ? 'H.264' : `${codecName(video.codec, null)} or H.264`
  return `This browser can’t encode ${tried} video, so Precise isn’t available. Fast still works.`
}

/** Where a fast trim really starts, when its keyframe is more than a frame before the in point. */
export function keyframeNote(start: number, keyframe: number | null, frameRate: number | null): string | null {
  if (keyframe === null || start - keyframe <= frameDuration(frameRate) + 1e-9) return null
  const before = (start - keyframe).toFixed(2)
  return `Starts at ${formatTimecode(keyframe)}, the nearest keyframe, ${before} s before your in point.`
}

/** The source's extension, when it has one. */
const extensionOf = (name: string) => (stem(name) === name ? null : name.slice(stem(name).length + 1))

/** Trim (SPEC.md 6.3): every track cut to the range. Fast copies everything, so the video starts on
 * the keyframe at or before the in point; Precise re-encodes the video so it starts on the exact frame,
 * and copies the audio. Audio on its own is always cut fast: every audio packet is a keyframe. */
export function planTrim(
  info: MediaInfo,
  range: TimeRange,
  mode: TrimMode,
  codecs: ContainerCodecs,
  caps: Capabilities,
): Planned {
  const video = videoTrack(info)
  if (range.end <= range.start) return { problems: ['The out point must be after the in point.'] }
  if (video && range.end - range.start < frameDuration(video.frameRate) - 1e-9) {
    return { problems: ['The range must be at least one frame long.'] }
  }
  const precise = !!video && mode === 'precise'
  if (precise) {
    const problem = preciseProblem(info, caps)
    if (problem) return { problems: [problem] }
  }

  // A track whose codec Mediabunny can't name can't be copied; the rest still can.
  const known = info.tracks.filter((t) => t.codec)
  const unknown = info.tracks.filter((t) => !t.codec)
  if (!known.length) return { problems: ['Moviola can’t tell which codecs this file uses, so it can’t cut it.'] }
  const hints = unknown.map((t) => `Moviola can’t tell which codec ${article(t)} track uses, so it’s left out.`)

  const codec = precise ? preciseCodec(video.codec, caps)! : null
  const codecOf = (t: Track) => (t.kind === 'video' && codec ? codec : t.codec!)
  const holdsAll = (c: OutputContainer) => known.every((t) => codecs[c].includes(codecOf(t)))
  // The source's own container when it can hold the result; else MP4 for a Precise trim that changed
  // codec, else MKV, which holds nearly anything.
  const fallbacks: OutputContainer[] = codec && codec !== video?.codec ? ['mp4', 'mkv'] : ['mkv']
  const container = [info.container, ...fallbacks].find(holdsAll)
  if (!container) return { problems: ['Moviola can’t write these tracks into any file type it knows.'] }

  const kind = video ? 'video' : 'audio'
  const { extension, mimeType } = destination(container, kind)
  const own = container === info.container ? extensionOf(info.name) : null
  const plan: Plan = {
    kind,
    container,
    name: outputName(info.name, ' (trimmed)', own ?? extension),
    mimeType,
    lossless: !precise,
    keep: known.map((t) => t.id),
    trim: { start: range.start + info.start, end: range.end + info.start },
    ...(codec && { video: { codec, ...(video!.bitrate && { bitrate: video!.bitrate }) } }),
  }
  const to = codec && codec !== video!.codec ? ` to ${codecName(codec, null)}` : ''
  const caption = precise
    ? `Video re-encoded${to}${hasAudio(info) ? ', audio copied' : ''}.`
    : 'Every track copied as is. No quality is lost.'
  return { plan, caption, ...(hints.length && { hints }) }
}

const article = (t: Track) => (t.kind === 'audio' ? 'an audio' : `a ${t.kind}`)
