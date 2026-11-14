import { describe, expect, it } from 'vitest'
import { gpuScalable, needsMipmaps, textureCorners } from './scale'

const job = (change: object = {}) => ({
  width: 720,
  height: 1280,
  fit: 'fill' as const,
  rotation: 270 as const,
  flip: false,
  crop: { left: 0, top: 0, width: 1080, height: 1920 },
  alpha: 'discard' as const,
  ...change,
})
// A landscape-coded phone video shown in portrait.
const source = { width: 1920, height: 1080 }

describe('gpuScalable', () => {
  it('takes a plain resize of the whole frame, rotated or not', () => {
    expect(gpuScalable(job(), source)).toBe(true)
    expect(gpuScalable(job({ rotation: 0, crop: { left: 0, top: 0, width: 1920, height: 1080 } }), source)).toBe(true)
  })

  it('leaves crops, letterboxing and kept transparency to Mediabunny', () => {
    expect(gpuScalable(job({ crop: { left: 0, top: 10, width: 1080, height: 1900 } }), source)).toBe(false)
    expect(gpuScalable(job({ fit: 'contain' }), source)).toBe(false)
    expect(gpuScalable(job({ alpha: 'keep' }), source)).toBe(false)
  })
})

// Corners in triangle-strip order (bottom left, bottom right, top left, top right of the output), each
// the point of the source frame drawn there, with y running down the frame.
describe('textureCorners', () => {
  it('draws the frame as it is with no rotation', () => {
    expect(textureCorners(0, false)).toEqual([0, 1, 1, 1, 0, 0, 1, 0])
  })

  it('turns the frame clockwise: the output’s top right shows the source’s top left at 90°', () => {
    expect(textureCorners(90, false)).toEqual([1, 1, 1, 0, 0, 1, 0, 0])
  })

  it('turns it upside down at 180° and counter-clockwise at 270°', () => {
    expect(textureCorners(180, false)).toEqual([1, 0, 0, 0, 1, 1, 0, 1])
    expect(textureCorners(270, false)).toEqual([0, 0, 0, 1, 1, 0, 1, 1])
  })

  it('flips after rotating, as Mediabunny does', () => {
    expect(textureCorners(0, true)).toEqual([1, 1, 0, 1, 1, 0, 0, 0])
    expect(textureCorners(90, true)).toEqual([1, 0, 1, 1, 0, 0, 0, 1])
  })
})

describe('needsMipmaps', () => {
  it('only past a 2× downscale, where bilinear sampling starts skipping pixels', () => {
    expect(needsMipmaps(1080, 1920, 720, 1280)).toBe(false)
    expect(needsMipmaps(1080, 1920, 540, 960)).toBe(false)
    expect(needsMipmaps(1080, 1920, 480, 852)).toBe(true)
  })
})
