import type { VideoSampleTransformationDescription } from 'mediabunny'

type Size = { width: number; height: number }

/** Whether the GPU scaler can do a transform: a plain resize of the whole frame, rotated or flipped.
 * Crops, letterboxing and kept transparency go to Mediabunny's canvas. `source` is the frame's
 * square-pixel size before rotation. */
export function gpuScalable(job: VideoSampleTransformationDescription, source: Size): boolean {
  const [width, height] = job.rotation % 180 ? [source.height, source.width] : [source.width, source.height]
  const { crop } = job
  const whole = crop.left === 0 && crop.top === 0 && crop.width === width && crop.height === height
  return job.fit === 'fill' && job.alpha === 'discard' && whole
}

// The output's corners in triangle-strip order (bottom left, bottom right, top left, top right), with
// y running down the picture.
const CORNERS = [
  [0, 1],
  [1, 1],
  [0, 0],
  [1, 0],
]

/** The point of the source frame (0–1, y down) drawn at each output corner, so a frame rotated
 * clockwise by `rotation` and then flipped horizontally fills the output. */
export function textureCorners(rotation: number, flip: boolean): number[] {
  return CORNERS.flatMap(([outX, y]) => {
    // The flip is applied after the rotation, so it's undone first.
    const x = flip ? 1 - outX : outX
    if (rotation === 90) return [y, 1 - x]
    if (rotation === 180) return [1 - x, 1 - y]
    if (rotation === 270) return [1 - y, x]
    return [x, y]
  })
}

/** Past a 2× downscale bilinear sampling skips pixels and the picture aliases, so the scaler samples
 * from mipmaps (Mediabunny's canvas halves the picture in steps for the same reason). Sizes are after
 * rotation. */
export const needsMipmaps = (fromWidth: number, fromHeight: number, toWidth: number, toHeight: number) =>
  2 * toWidth < fromWidth && 2 * toHeight < fromHeight
