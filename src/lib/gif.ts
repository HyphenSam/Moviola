import { applyPalette, GIFEncoder, quantize } from 'gifenc'

export type GifOptions = { width: number; height: number; frameRate: number; loop: boolean }

/** Writes an animated GIF from RGBA frames (SPEC.md 6.8): each frame quantised to its own 256 colours.
 * The first frame's palette is the global one; later frames carry their own. */
export function gifWriter({ width, height, frameRate, loop }: GifOptions) {
  const gif = GIFEncoder()
  let count = 0
  // GIF counts delays in hundredths of a second, which 15 fps doesn't divide. Each frame ends where
  // its own time rounds to, so the delays alternate (7, 7, 6…) and a second of frames lasts a second.
  const hundredths = (frame: number) => Math.round((frame * 100) / frameRate)
  return {
    add(rgba: Uint8Array | Uint8ClampedArray) {
      const palette = quantize(rgba, 256)
      const delay = (hundredths(count + 1) - hundredths(count)) * 10
      // `repeat` 0 loops forever; −1 leaves the loop extension out, so the GIF plays once.
      gif.writeFrame(applyPalette(rgba, palette), width, height, { palette, delay, repeat: loop ? 0 : -1 })
      count++
    },
    finish(): Uint8Array {
      gif.finish()
      return gif.bytesView()
    },
  }
}
