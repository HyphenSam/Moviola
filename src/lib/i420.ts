// The maths of `src/media/i420.ts`, which turns RGB frames into BT.709 I420 with WebGL before they reach
// a video encoder (see the note there).

const KR = 0.2126
const KB = 0.0722
const KG = 1 - KR - KB
const LUMA = 219 / 255
const CHROMA = 224 / 255

/** Limited-range BT.709: Y′CbCr (0–1) = offsets + matrix × R′G′B′ (0–1). The matrix is column-major,
 * as GLSL's `mat3` takes it. */
export const BT709 = {
  offsets: [16 / 255, 128 / 255, 128 / 255],
  matrix: [
    // R′
    KR * LUMA,
    (-KR / (2 * (1 - KB))) * CHROMA,
    0.5 * CHROMA,
    // G′
    KG * LUMA,
    (-KG / (2 * (1 - KB))) * CHROMA,
    (-KG / (2 * (1 - KR))) * CHROMA,
    // B′
    KB * LUMA,
    0.5 * CHROMA,
    (-KB / (2 * (1 - KR))) * CHROMA,
  ],
}

/** The size in pixels of the RGBA drawing whose bytes, read back, are an I420 frame of `width` ×
 * `height`: luma, Cb and Cr planes back to back, packed tight, four bytes to a pixel (the last row padded).
 * `chroma` is each chroma plane's size. */
export function i420Layout(width: number, height: number) {
  const chroma = { width: Math.ceil(width / 2), height: Math.ceil(height / 2) }
  const pixels = Math.ceil(width / 4)
  const bytes = width * height + 2 * chroma.width * chroma.height
  return { width: pixels, height: Math.ceil(bytes / (pixels * 4)), chroma }
}
