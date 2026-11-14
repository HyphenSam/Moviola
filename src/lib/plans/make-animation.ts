import type { Capabilities } from '../capabilities'
import { codecName, videoTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { AnimationPlan, Planned } from '../plan'
import { formatTimecode } from '../timecode'
import type { TimeRange } from './trim'

export const ANIMATION_WIDTHS = [320, 480, 640] as const
export const ANIMATION_RATES = [10, 15, 20] as const

export type AnimationFormat = 'gif' | 'webp'

/** `width` is one of ANIMATION_WIDTHS as chosen, or the video's own width where it's narrower than all of them. */
export type AnimationSettings = {
  format: AnimationFormat
  width: number
  frameRate: (typeof ANIMATION_RATES)[number]
  loop: boolean
}

export const DEFAULT_ANIMATION: AnimationSettings = { format: 'gif', width: 480, frameRate: 15, loop: true }

/** Past this, an animation gets large enough that a hint suggests a video; past `LONGEST`, it isn't made. */
const LONG = 15
const LONGEST = 60

/** Make animation's range until the user picks one (or picks one in Trim): the first five seconds. */
export const animationRange = (info: MediaInfo): TimeRange => ({ start: 0, end: Math.min(5, info.duration) })

/** The widths on offer; never wider than the video. */
export function widthOptions(info: MediaInfo) {
  const own = videoTrack(info)?.width ?? 0
  return ANIMATION_WIDTHS.map((value) => ({ value, disabled: value > own }))
}

/** The width an animation is made at: the chosen one if the video is that wide, else the widest that
 * fits, else the video's own. */
export function animationWidth(info: MediaInfo, chosen: number): number {
  const own = videoTrack(info)?.width ?? chosen
  const fits = ANIMATION_WIDTHS.filter((w) => w <= own)
  return chosen <= own ? chosen : (fits.at(-1) ?? own)
}

const CAPTIONS = {
  gif: 'GIFs are limited to 256 colours.',
  webp: 'Full colour and smaller than a GIF, but some sites and apps take only GIFs.',
}

/** Make animation (SPEC.md 6.8): the range's frames at the chosen width and rate, as a GIF (256
 * colours a frame) or an animated WebP. */
export function planAnimation(
  info: MediaInfo,
  range: TimeRange,
  settings: AnimationSettings,
  caps: Capabilities,
): Planned<AnimationPlan> {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!video.canDecode) {
    return {
      problems: [`This browser can’t decode ${codecName(video.codec, null)}, so it can’t make an animation from it.`],
    }
  }
  if (settings.format === 'webp' && !caps.encodeWebp) {
    return { problems: ['This browser can’t make WebP images. Choose GIF.'] }
  }
  const length = range.end - range.start
  if (length <= 0) return { problems: ['The out point must be after the in point.'] }
  if (length < 1 / settings.frameRate - 1e-9) return { problems: ['The range must be at least one frame long.'] }
  if (length > LONGEST + 1e-9) {
    return {
      problems: [`An animation can be at most a minute long, and this range is ${formatTimecode(length)}. Shorten it.`],
    }
  }

  const width = animationWidth(info, settings.width)
  const plan: AnimationPlan = {
    kind: 'animation',
    name: outputName(info.name, '', settings.format),
    mimeType: settings.format === 'gif' ? 'image/gif' : 'image/webp',
    lossless: false,
    start: range.start + info.start,
    end: range.end + info.start,
    width,
    height: Math.max(1, Math.round((width * video.height) / video.width)),
    frameRate: settings.frameRate,
    loop: settings.loop,
  }
  const hints = length > LONG + 1e-9 ? ['Long animations get large; consider a video instead.'] : undefined
  return { plan, caption: CAPTIONS[settings.format], ...(hints && { hints }) }
}
