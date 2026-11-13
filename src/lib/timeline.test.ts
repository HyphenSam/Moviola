import { describe, expect, it } from 'vitest'
import { moveEnd, thumbnailCount, thumbnailTimes, timeAt } from './timeline'

describe('timeAt', () => {
  it('turns a position along the strip into a time', () => {
    expect(timeAt(0, 400, 80)).toBe(0)
    expect(timeAt(100, 400, 80)).toBe(20)
    expect(timeAt(400, 400, 80)).toBe(80)
  })

  it('keeps to the file when the pointer leaves the strip, and copes with a strip of no width', () => {
    expect(timeAt(-30, 400, 80)).toBe(0)
    expect(timeAt(500, 400, 80)).toBe(80)
    expect(timeAt(10, 0, 80)).toBe(0)
  })
})

describe('thumbnails', () => {
  it('fits as many thumbnails as the strip holds at the video’s shape, rounding up to fill it', () => {
    // 16:9 at 48 px high is 85⅓ px wide.
    expect(thumbnailCount(640, 16 / 9, 48)).toBe(8)
    expect(thumbnailCount(682, 16 / 9, 48)).toBe(8)
    expect(thumbnailCount(683, 16 / 9, 48)).toBe(9)
    // Portrait video: narrower thumbnails, more of them.
    expect(thumbnailCount(640, 9 / 16, 48)).toBe(24)
  })

  it('has none for a strip of no width', () => {
    expect(thumbnailCount(0, 16 / 9, 48)).toBe(0)
  })

  it('takes each thumbnail from the middle of its stretch of the file', () => {
    expect(thumbnailTimes(80, 4)).toEqual([10, 30, 50, 70])
    expect(thumbnailTimes(80, 0)).toEqual([])
  })
})

describe('moveEnd', () => {
  const range = { start: 10, end: 20 }

  it('moves the in or out point to a time, on the frame showing there', () => {
    expect(moveEnd(range, 'start', 12.07, 25, 80)).toEqual({ start: 12.04, end: 20 })
    expect(moveEnd(range, 'end', 30, 25, 80)).toEqual({ start: 10, end: 30 })
  })

  it('keeps the in point at least a frame before the out point, and the out point a frame after', () => {
    expect(moveEnd(range, 'start', 25, 25, 80)).toEqual({ start: 19.96, end: 20 })
    expect(moveEnd(range, 'end', 5, 25, 80)).toEqual({ start: 10, end: 10.04 })
  })

  it('keeps both within the file', () => {
    expect(moveEnd(range, 'start', -3, 25, 80)).toEqual({ start: 0, end: 20 })
    expect(moveEnd(range, 'end', 99, 25, 80)).toEqual({ start: 10, end: 80 })
  })

  it('lets the out point reach the very end even off the frame grid', () => {
    expect(moveEnd(range, 'end', 83.5, 30, 83.5)).toEqual({ start: 10, end: 83.5 })
  })
})
