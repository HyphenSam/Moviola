import { describe, expect, it } from 'vitest'
import { fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { DEFAULT_GIF, gifRange, gifWidth, planGif, widthOptions, type GifSettings } from './make-gif'

const plan = (range = { start: 10, end: 14 }, settings: Partial<GifSettings> = {}, info = fakeInfo()) =>
  planGif(info, range, { ...DEFAULT_GIF, ...settings })

const portrait = fakeInfo({ tracks: [fakeVideoTrack({ width: 1080, height: 1920, rotation: 90 })] })
const tiny = fakeInfo({ tracks: [fakeVideoTrack({ width: 400, height: 300 })] })

describe('planGif', () => {
  it('makes a looping 480 px GIF at 15 fps from the range by default, saying it re-encodes', () => {
    const planned = plan()
    expect(planned.plan).toEqual({
      kind: 'gif',
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
    expect(plan({ start: 0, end: 15.5 }).hints).toEqual(['Long GIFs get large; consider a video instead.'])
    expect(plan({ start: 0, end: 60 }).plan).toBeDefined()
    expect(plan({ start: 0, end: 61 })).toEqual({
      problems: ['A GIF can be at most a minute long, and this range is 1:01.000. Shorten it.'],
    })
  })

  it('needs a range at least one GIF frame long, with the out point after the in point', () => {
    expect(plan({ start: 5, end: 5 })).toEqual({ problems: ['The out point must be after the in point.'] })
    expect(plan({ start: 5, end: 5.05 })).toEqual({ problems: ['The range must be at least one frame long.'] })
    expect(plan({ start: 5, end: 5.07 }).plan).toBeDefined()
  })

  it('can’t make a GIF from video this browser can’t decode', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] })
    expect(plan(undefined, {}, info)).toEqual({
      problems: ['This browser can’t decode HEVC, so it can’t make a GIF from it.'],
    })
  })
})

describe('gifRange', () => {
  it('is the first five seconds, or the whole of a shorter file', () => {
    expect(gifRange(fakeInfo())).toEqual({ start: 0, end: 5 })
    expect(gifRange(fakeInfo({ duration: 3.2 }))).toEqual({ start: 0, end: 3.2 })
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
    expect(gifWidth(tiny, 640)).toBe(320)
    expect(gifWidth(fakeInfo({ tracks: [fakeVideoTrack({ width: 240, height: 180 })] }), 480)).toBe(240)
  })
})
