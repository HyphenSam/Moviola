import { BlobSource, CanvasSink, Input, type InputVideoTrack } from 'mediabunny'
import { gifWriter } from '@/lib/gif'
import { codecName } from '@/lib/info'
import type { AnimationPlan, FramePlan } from '@/lib/plan'
import { webpAnimationWriter } from '@/lib/webp'
import { decodeAsPlayed } from './colour'
import { FORMATS } from './probe'
import { CANCELLED, JobProblem } from './run'

type Options = { onProgress?: (fraction: number) => void; signal?: AbortSignal }

/** Opens the file's primary video track for an image job, and lets it go when `use` is done. */
async function withVideo<T>(file: File, use: (track: InputVideoTrack, first: number) => Promise<T>): Promise<T> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new JobProblem('This file has no video.')
    if (!(await track.canDecode()))
      throw new JobProblem(`This browser can’t decode ${codecName(await track.getCodec(), null)} video.`)
    await decodeAsPlayed(track)
    return await use(track, await track.getFirstTimestamp())
  } finally {
    input.dispose()
  }
}

/** Grab frame (SPEC.md 6.7): the frame showing at the plan's time, at the full display size with the
 * track's rotation applied (CanvasSink's defaults), in the plan's format and quality. Before the
 * first picture (audio can start a little earlier), the first picture. */
export function grabFrame(file: File, plan: FramePlan): Promise<Blob> {
  return withVideo(file, async (track, first) => {
    const wrapped = await new CanvasSink(track).getCanvas(Math.max(plan.time, first))
    if (!wrapped) throw new JobProblem('There’s no frame at this point in the video.')
    const canvas = copy(wrapped.canvas, wrapped.canvas.width, wrapped.canvas.height)
    return encode(canvas, plan.mimeType, plan.quality)
  })
}

/** An animated WebP's frames are lossy WebPs at this quality: libwebp's own default is 0.75, and
 * Make animation's frames are small, so a little more keeps faces and text clean. */
const WEBP_QUALITY = 0.8

/** Make animation (SPEC.md 6.8): a frame every 1 / rate seconds through the range, at the plan's size,
 * each quantised to 256 colours for a GIF or encoded by the canvas for a WebP. Progress counts frames;
 * a cancel stops between them. */
export function makeAnimation(file: File, plan: AnimationPlan, { onProgress, signal }: Options = {}): Promise<Blob> {
  return withVideo(file, async (track, first) => {
    const { width, height, frameRate, mimeType } = plan
    const count = Math.max(1, Math.round((plan.end - plan.start) * frameRate))
    const times = Array.from({ length: count }, (_, i) => Math.max(plan.start + i / frameRate, first))
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 2 })
    const gif = mimeType === 'image/gif' ? gifWriter(plan) : null
    const webp = mimeType === 'image/webp' ? webpAnimationWriter(plan) : null
    let done = 0
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (signal?.aborted) throw new JobProblem(CANCELLED)
      if (!wrapped) continue
      const canvas = copy(wrapped.canvas, width, height)
      if (gif) gif.add(canvas.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, width, height).data)
      else webp!.add(new Uint8Array(await (await encode(canvas, mimeType, WEBP_QUALITY)).arrayBuffer()))
      onProgress?.(++done / count)
    }
    if (!done) throw new JobProblem('There are no frames in this range.')
    const bytes = gif ? gif.finish() : webp!.finish()
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType })
  })
}

const IMAGE_NAMES: Record<string, string> = { 'image/png': 'PNG', 'image/jpeg': 'JPEG', 'image/webp': 'WebP' }

/** The canvas as an image. A canvas that can't write the type asked for writes a PNG instead, which
 * would be saved under the wrong name, so that's a failure. */
async function encode(canvas: OffscreenCanvas, type: string, quality: number): Promise<Blob> {
  const blob = await canvas.convertToBlob({ type, quality })
  if (blob.type !== type) throw new JobProblem(`This browser can’t make ${IMAGE_NAMES[type] ?? type} images.`)
  return blob
}

/** The sink's canvas drawn onto one of our own, which can be read back and encoded however the sink
 * made its canvas (and before the sink's pool reuses it). */
function copy(source: CanvasImageSource, width: number, height: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(source, 0, 0, width, height)
  return canvas
}
