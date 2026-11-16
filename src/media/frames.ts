import { ALL_FORMATS, BlobSource, CanvasSink, Input, type WrappedCanvas } from 'mediabunny'
import { decodeAsPlayed } from './colour'
import { firstTimestamp, FORMATS } from './probe'

/** A decoded frame, ready to draw. */
export type Frame = {
  image: CanvasImageSource & { width: number; height: number }
  timestamp: number
  duration: number
}

/** Decoded frames of a file's primary video track, scaled to fit a box, rotation applied. Times
 * count from the file's first timestamp, as the playhead does (MediaInfo `start`). */
export type FrameSource = {
  /** The frame showing at `time`, or null if there's none (or the video can't be decoded). */
  frameAt(time: number): Promise<Frame | null>
  /** Every frame from `time` on, in order, for playing without native playback. */
  framesFrom(time: number): AsyncGenerator<Frame>
  dispose(): void
}

export type OpenFrames = (file: File, box: { width: number; height: number }) => FrameSource

/** Opens a file for frames on the page. Decoding is WebCodecs, off the main thread, so drawing a
 * frame doesn't hold up the UI. The file is read lazily, as for probing. */
export const openFrames: OpenFrames = (file, box) => {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  // Pool a few canvases: each frame is drawn onto the stage's own canvas straight away.
  const ready = input.getPrimaryVideoTrack().then(async (track) => {
    if (!track || !(await track.canDecode())) return null
    await decodeAsPlayed(track)
    const [w, h, start, first] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      firstTimestamp(input),
      track.getFirstTimestamp(),
    ])
    const scale = Math.min(1, box.width / w, box.height / h)
    const sink = new CanvasSink(track, { width: Math.max(2, Math.round(w * scale)), poolSize: 3 })
    // The audio can start a little before the first picture; until it, show the first picture.
    return { start, sink, at: (time: number) => Math.max(time + start, first) }
  })
  const frame = (c: WrappedCanvas, start: number): Frame => ({
    image: c.canvas,
    timestamp: c.timestamp - start,
    duration: c.duration,
  })

  return {
    async frameAt(time) {
      const r = await ready
      const c = r && (await r.sink.getCanvas(r.at(time)))
      return c && r ? frame(c, r.start) : null
    },
    async *framesFrom(time) {
      const r = await ready
      if (!r) return
      for await (const c of r.sink.canvases(r.at(time))) yield frame(c, r.start)
    },
    dispose: () => input.dispose(),
  }
}

/** The timeline's thumbnails: frames of the primary video track at `times` (counted from the playhead's
 * 0), `height` pixels high with rotation applied, as bitmaps that can be sent to the page. None when
 * there's no video this browser can decode; null for a single frame that couldn't be had. */
export async function thumbnails(file: File, times: number[], height: number): Promise<(ImageBitmap | null)[]> {
  const input = new Input({ source: new BlobSource(file), formats: [...FORMATS.keys()] })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return []
    await decodeAsPlayed(track)
    const [start, first] = await Promise.all([firstTimestamp(input), track.getFirstTimestamp()])
    const sink = new CanvasSink(track, { height: Math.round(height) })
    const images: (ImageBitmap | null)[] = []
    // Before the first picture (audio can start a little earlier), show the first picture.
    for await (const c of sink.canvasesAtTimestamps(times.map((t) => Math.max(t + start, first)))) {
      images.push(c ? await createImageBitmap(c.canvas) : null)
    }
    return images
  } finally {
    input.dispose()
  }
}
