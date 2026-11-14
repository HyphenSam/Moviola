import { canEncodeAudio, canEncodeVideo } from 'mediabunny'
import { ADD_ON_CODECS, probeCapabilities, videoEncodersAt, type AudioEncodeCodec } from '@/lib/capabilities'
import type { Size, WorkerCapabilities } from '@/lib/protocol'

/** What this browser can encode. The add-ons count without being loaded: they run wherever
 * WebAssembly does, and loading them is left until a job needs one. */
export const capabilities = (): Promise<WorkerCapabilities> =>
  probeCapabilities({
    canEncodeVideo: (codec, size) => canEncodeVideo(codec, size),
    canEncodeAudio: (codec) => canEncodeAudio(codec),
    canEncodeWebp,
    wasm: typeof WebAssembly === 'object',
  })

/** A canvas that can't write WebP quietly writes a PNG instead, so the type that comes back is the answer.
 * Chrome won't encode a canvas that has no context, hence the `getContext`. */
async function canEncodeWebp() {
  const canvas = new OffscreenCanvas(1, 1)
  canvas.getContext('2d')
  return (await canvas.convertToBlob({ type: 'image/webp' })).type === 'image/webp'
}

/** Which video codecs this browser can encode at `size`. */
export const encodableAt = (size: Size) => videoEncodersAt((codec, at) => canEncodeVideo(codec, at), size)

// Each add-on is a few hundred kB of WebAssembly, so it's imported only when a job needs it, and
// then only once.
const ADD_ONS: Record<string, () => Promise<() => void>> = {
  mp3: () => import('@mediabunny/mp3-encoder').then((m) => m.registerMp3Encoder),
  flac: () => import('@mediabunny/flac-encoder').then((m) => m.registerFlacEncoder),
  aac: () => import('@mediabunny/aac-encoder').then((m) => m.registerAacEncoder),
}
const registered = new Map<string, Promise<void>>()

/** Registers the add-on encoder for `codec` when the browser can't encode it itself. Anything
 * Mediabunny encodes on its own (PCM) or that has no add-on passes through untouched. */
export function ensureEncoder(codec: string): Promise<void> {
  if (!ADD_ON_CODECS.includes(codec as AudioEncodeCodec)) return Promise.resolve()
  let ready = registered.get(codec)
  if (!ready) {
    ready = (async () => {
      if (await canEncodeAudio(codec as AudioEncodeCodec).catch(() => false)) return
      ;(await ADD_ONS[codec]())()
    })()
    registered.set(codec, ready)
  }
  return ready
}
