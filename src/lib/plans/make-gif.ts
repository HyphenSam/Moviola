import { codecName, videoTrack, type MediaInfo } from '../info'
import { outputName } from '../names'
import type { GifPlan, Planned } from '../plan'
import { formatTimecode } from '../timecode'
import type { TimeRange } from './trim'

export const GIF_WIDTHS = [320, 480, 640] as const
export const GIF_RATES = [10, 15, 20] as const

/** `width` is one of GIF_WIDTHS as chosen, or the video's own width where it's narrower than all of them. */
export type GifSettings = { width: number; frameRate: (typeof GIF_RATES)[number]; loop: boolean }

export const DEFAULT_GIF: GifSettings = { width: 480, frameRate: 15, loop: true }

/** Past this, a GIF gets large enough that a hint suggests a video; past `LONGEST`, it isn't made. */
const LONG = 15
const LONGEST = 60

/** Make GIF's range until the user picks one (or picks one in Trim): the first five seconds. */
export const gifRange = (info: MediaInfo): TimeRange => ({ start: 0, end: Math.min(5, info.duration) })

/** The widths on offer; never wider than the video. */
export function widthOptions(info: MediaInfo) {
  const own = videoTrack(info)?.width ?? 0
  return GIF_WIDTHS.map((value) => ({ value, disabled: value > own }))
}

/** The width a GIF is made at: the chosen one if the video is that wide, else the widest that fits,
 * else the video's own. */
export function gifWidth(info: MediaInfo, chosen: number): number {
  const own = videoTrack(info)?.width ?? chosen
  const fits = GIF_WIDTHS.filter((w) => w <= own)
  return chosen <= own ? chosen : (fits.at(-1) ?? own)
}

/** Make GIF (SPEC.md 6.8): the range's frames at the chosen width and rate, 256 colours each. */
export function planGif(info: MediaInfo, range: TimeRange, settings: GifSettings): Planned<GifPlan> {
  const video = videoTrack(info)
  if (!video) return { problems: ['This file has no video.'] }
  if (!video.canDecode) {
    return { problems: [`This browser can’t decode ${codecName(video.codec, null)}, so it can’t make a GIF from it.`] }
  }
  const length = range.end - range.start
  if (length <= 0) return { problems: ['The out point must be after the in point.'] }
  if (length < 1 / settings.frameRate - 1e-9) return { problems: ['The range must be at least one frame long.'] }
  if (length > LONGEST + 1e-9) {
    return {
      problems: [`A GIF can be at most a minute long, and this range is ${formatTimecode(length)}. Shorten it.`],
    }
  }

  const width = gifWidth(info, settings.width)
  const plan: GifPlan = {
    kind: 'gif',
    name: outputName(info.name, '', 'gif'),
    mimeType: 'image/gif',
    lossless: false,
    start: range.start + info.start,
    end: range.end + info.start,
    width,
    height: Math.max(1, Math.round((width * video.height) / video.width)),
    frameRate: settings.frameRate,
    loop: settings.loop,
  }
  const hints = length > LONG + 1e-9 ? ['Long GIFs get large; consider a video instead.'] : undefined
  return { plan, caption: 'GIFs are limited to 256 colours.', ...(hints && { hints }) }
}
