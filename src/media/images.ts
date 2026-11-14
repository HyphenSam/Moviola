import { BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny'
import { gifWriter } from '@/lib/gif'
import type { FramePlan, GifPlan } from '@/lib/plan'
import { FORMATS } from './probe'
import { CANCELLED, JobProblem } from './run'

type Options = { onProgress?: (fraction: number) => void; signal?: AbortSignal }

/** Opens the file's primary video track for an image job, and lets it go when `use` is done. */
async function withVideo<T>(file: File, use: (track: InputVideoTrack, first: number) => Promise<T>): Promise<T> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new JobProblem('This browser can’t decode this video.')
    return await use(track, await track.getFirstTimestamp())
  } finally {
    input.dispose()
  }
}

/** Grab frame (SPEC.md 6.7): the frame showing at the plan's time, at the full display size with the
 * track's rotation applied (CanvasSink's defaults), as a PNG or a JPEG at quality 90. Before the
 * first picture (audio can start a little earlier), the first picture. */
export function grabFrame(file: File, plan: FramePlan): Promise<Blob> {
  return withVideo(file, async (track, first) => {
    const wrapped = await new CanvasSink(track).getCanvas(Math.max(plan.time, first))
    if (!wrapped) throw new JobProblem('There’s no frame at this point in the video.')
    const canvas = copy(wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height)
    return canvas.convertToBlob({ type: plan.mimeType, quality: 0.9 })
  })
}

/** Make GIF (SPEC.md 6.8): a frame every 1 / rate seconds through the range, at the plan's size, each
 * quantised to 256 colours. Progress counts frames; a cancel stops between them. */
export function makeGif(file: File, plan: GifPlan, { onProgress, signal }: Options = {}): Promise<Blob> {
  return withVideo(file, async (track, first) => {
    const { width, height, frameRate } = plan
    const count = Math.max(1, Math.round((plan.end - plan.start) * frameRate))
    const times = Array.from({ length: count }, (_, i) => Math.max(plan.start + i / frameRate, first))
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 })
    const gif = gifWriter(plan)
    let done = 0
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new JobProblem(CANCELLED)
      if (!wrapped) continue
      const canvas = copy(wrapped.canvas, width, height)
      gif.add(canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data)
      onProgress?.(++done / count)
    }
    if (!done) throw new JobProblem('There are no frames in this range.')
    return new Blob([gif.finish() as Uint8Array<ArrayBuffer>], { type: 'image/gif' })
  })
}

/** The sink's canvas drawn onto one of our own, which can be read back and encoded however the sink
 * made its canvas (and before the sink's pool reuses it). */
function copy(source: CanvasImageSource, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, width, height)
  return canvas
}
