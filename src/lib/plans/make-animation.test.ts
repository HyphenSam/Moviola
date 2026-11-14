import { describe, expect, it } from 'vitest'
import { ALL_CAPABLE, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import {
  animationRange,
  animationWidth,
  DEFAULT_ANIMATION,
  planAnimation,
  widthOptions,
  type AnimationSettings,
} from './make-animation'

const plan = (range = { start: 10, end: 14 }, settings: Partial<AnimationSettings> = {}, info = fakeInfo()) =>
  planAnimation(info, range, { ...DEFAULT_ANIMATION, ...settings }, ALL_CAPABLE)

const portrait = fakeInfo({ tracks: [fakeVideoTrack({ width: 1080, height: 1920, rotation: 90 })] })
const tiny = fakeInfo({ tracks: [fakeVideoTrack({ width: 400, height: 300 })] })

describe('planAnimation', () => {
  it('makes a looping 480 px GIF at 15 fps from the range by default', () => {
    const planned = plan()
    expect(planned.plan).toEqual({
      kind: 'animation',
      name: 'holiday.gif',
      mimeType: 'image/gif',
      lossless: false,
      start: 10,
      end: 14,
      width: 480,
      height: 270,
      frameRate: 15,
      loop: true,
    })
    expect(planned.caption).toBe('GIFs are limited to 256 colours.')
    expect(planned.hints).toBeUndefined()
  })

  it('makes an animated WebP in full colour, saying not everything takes one', () => {
    const planned = plan(undefined, { format: 'webp' })
    expect(planned.plan).toMatchObject({ kind: 'animation', name: 'holiday.webp', mimeType: 'image/webp' })
    expect(planned.caption).toBe('Full colour and smaller than a GIF, but some sites and apps take only GIFs.')
  })

  it('can’t make a WebP where the browser can’t', () => {
    const settings = { ...DEFAULT_ANIMATION, format: 'webp' as const }
    expect(planAnimation(fakeInfo(), { start: 0, end: 2 }, settings, { ...ALL_CAPABLE, encodeWebp: false })).toEqual({
      problems: ['This browser can’t make WebP images. Choose GIF.'],
    })
  })

  it('takes the chosen width, rate and loop, with the height following the picture', () => {
    expect(plan(undefined, { width: 640, frameRate: 20, loop: false }).plan).toMatchObject({
      width: 640,
      height: 360,
      frameRate: 20,
      loop: false,
    })
    expect(plan(undefined, { width: 320, frameRate: 10 }, portrait).plan).toMatchObject({
      width: 320,
      height: 569,
      frameRate: 10,
    })
  })

  it('counts from the file’s first timestamp', () => {
    const info = fakeInfo({ name: 'match.ts', container: 'mpegts', start: 1.4 })
    expect(plan({ start: 0, end: 2 }, {}, info).plan).toMatchObject({ name: 'match.gif', start: 1.4, end: 3.4 })
  })

  it('never makes it wider than the video', () => {
    expect(plan(undefined, { width: 640 }, tiny).plan).toMatchObject({ width: 320, height: 240 })
    const smaller = fakeInfo({ tracks: [fakeVideoTrack({ width: 240, height: 180 })] })
    expect(plan(undefined, { width: 320 }, smaller).plan).toMatchObject({ width: 240, height: 180 })
  })

  it('warns past 15 seconds and refuses past a minute', () => {
    expect(plan({ start: 0, end: 15 }).hints).toBeUndefined()
    expect(plan({ start: 0, end: 15.5 }).hints).toEqual(['Long animations get large; consider a video instead.'])
    expect(plan({ start: 0, end: 60 }).plan).toBeDefined()
    expect(plan({ start: 0, end: 61 })).toEqual({
      problems: ['An animation can be at most a minute long, and this range is 1:01.000. Shorten it.'],
    })
  })

  it('needs a range at least one frame long, with the out point after the in point', () => {
    expect(plan({ start: 5, end: 5 })).toEqual({ problems: ['The out point must be after the in point.'] })
    expect(plan({ start: 5, end: 5.05 })).toEqual({ problems: ['The range must be at least one frame long.'] })
    expect(plan({ start: 5, end: 5.07 }).plan).toBeDefined()
  })

  it('can’t make an animation from video this browser can’t decode', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] })
    expect(plan(undefined, {}, info)).toEqual({
      problems: ['This browser can’t decode HEVC, so it can’t make an animation from it.'],
    })
  })
})

describe('animationRange', () => {
  it('is the first five seconds, or the whole of a shorter file', () => {
    expect(animationRange(fakeInfo())).toEqual({ start: 0, end: 5 })
    expect(animationRange(fakeInfo({ duration: 3.2 }))).toEqual({ start: 0, end: 3.2 })
  })
})

describe('widths', () => {
  it('offers only widths up to the video’s own', () => {
    expect(widthOptions(fakeInfo())).toEqual([
      { value: 320, disabled: false },
      { value: 480, disabled: false },
      { value: 640, disabled: false },
    ])
    expect(widthOptions(tiny)).toEqual([
      { value: 320, disabled: false },
      { value: 480, disabled: true },
      { value: 640, disabled: true },
    ])
  })

  it('falls back to the widest that fits, or the video’s own width when none does', () => {
    expect(animationWidth(tiny, 640)).toBe(320)
    expect(animationWidth(fakeInfo({ tracks: [fakeVideoTrack({ width: 240, height: 180 })] }), 480)).toBe(240)
  })
})
