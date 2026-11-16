import { describe, expect, it } from 'vitest'
import { BT709, i420Layout } from './i420'

/** Applies BT709 as the shader does: offsets plus the column-major matrix times R'G'B' (0–1), in bytes. */
const yuv = (r: number, g: number, b: number) =>
  [0, 1, 2].map((row) =>
    Math.round(
      255 *
        (BT709.offsets[row] + (BT709.matrix[row] * r + BT709.matrix[row + 3] * g + BT709.matrix[row + 6] * b) / 255),
    ),
  )

describe('BT709', () => {
  it('turns R′G′B′ into limited-range BT.709 Y′CbCr', () => {
    expect(yuv(0, 0, 0)).toEqual([16, 128, 128])
    expect(yuv(255, 255, 255)).toEqual([235, 128, 128])
    // As Chrome's encoder writes them from RGB frames, and ffmpeg reads them back.
    expect(yuv(255, 0, 0)).toEqual([63, 102, 240])
    expect(yuv(0, 255, 0)).toEqual([173, 42, 26])
    expect(yuv(0, 0, 255)).toEqual([32, 240, 118])
    expect(yuv(200, 120, 40)).toEqual([129, 85, 166])
  })
})

describe('i420Layout', () => {
  // Firefox ignores a frame's plane strides and reads the planes packed tight, as an I420 frame's bytes
  // run by default; chroma rows padded to 92 bytes for a 180-wide frame came out sheared.
  it('runs the planes back to back as an I420 frame’s bytes do, four bytes to a pixel', () => {
    expect(i420Layout(1280, 720)).toEqual({ width: 320, height: 1080, chroma: { width: 640, height: 360 } })
    expect(i420Layout(180, 320)).toEqual({ width: 45, height: 480, chroma: { width: 90, height: 160 } })
  })

  it('rounds up to whole pixels and rows, and odd sizes to whole chroma samples', () => {
    // 90 × 160: 14,400 bytes of luma and 3,600 of each chroma plane, in rows of 23 pixels (92 bytes).
    expect(i420Layout(90, 160)).toEqual({ width: 23, height: 235, chroma: { width: 45, height: 80 } })
    expect(i420Layout(641, 361)).toEqual({ width: 161, height: 540, chroma: { width: 321, height: 181 } })
  })
})
