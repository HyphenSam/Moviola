/** What this browser can encode, as plain data (SPEC.md section 9). Probed once in the worker at
 * start-up; the page adds `saveToDisk`. Planners take it as an argument, so tests can describe any
 * browser. Decoding is per track (`Track.canDecode`). */
export type Capabilities = {
  /** `showSaveFilePicker`, checked on the page. */
  saveToDisk: boolean
  /** At 1080p; re-checked at the chosen size before running. */
  encodeVideo: Partial<Record<VideoEncodeCodec, boolean>>
  /** Counting the add-on encoders, so all true where WebAssembly runs, apart from Opus. */
  encodeAudio: Partial<Record<AudioEncodeCodec, boolean>>
  /** WebP images from a canvas, for Grab frame and Make animation. */
  encodeWebp: boolean
}

export type VideoEncodeCodec = 'avc' | 'hevc' | 'vp9' | 'av1'
export type AudioEncodeCodec = 'aac' | 'opus' | 'mp3' | 'flac'

const VIDEO: VideoEncodeCodec[] = ['avc', 'hevc', 'vp9', 'av1']
const AUDIO: AudioEncodeCodec[] = ['aac', 'opus', 'mp3', 'flac']

/** The codecs Mediabunny's add-ons encode in WebAssembly when the browser can't (`src/media/encoders.ts`). */
export const ADD_ON_CODECS: readonly AudioEncodeCodec[] = ['mp3', 'flac', 'aac']

/** Mediabunny's checks, passed in so this module stays free of its runtime. */
export type EncodeChecks = {
  canEncodeVideo: (codec: VideoEncodeCodec, size: { width: number; height: number }) => Promise<boolean>
  canEncodeAudio: (codec: AudioEncodeCodec) => Promise<boolean>
  canEncodeWebp: () => Promise<boolean>
  wasm: boolean
}

// A check that throws (no encoder at all, say) is a no.
const ask = (check: () => Promise<boolean>) => check().catch(() => false)

/** Which video codecs this browser can encode at `size`. Compress asks again at the size it will
 * write, since an encoder that manages 1080p may not manage another size (SPEC.md section 9). */
export async function videoEncodersAt(
  check: EncodeChecks['canEncodeVideo'],
  size: { width: number; height: number },
): Promise<Capabilities['encodeVideo']> {
  const video = await Promise.all(VIDEO.map((c) => ask(() => check(c, size))))
  return Object.fromEntries(VIDEO.map((c, i) => [c, video[i]]))
}

export async function probeCapabilities(checks: EncodeChecks): Promise<Omit<Capabilities, 'saveToDisk'>> {
  const audio = await Promise.all(AUDIO.map((c) => ask(() => checks.canEncodeAudio(c))))
  return {
    encodeVideo: await videoEncodersAt(checks.canEncodeVideo, { width: 1920, height: 1080 }),
    encodeAudio: Object.fromEntries(AUDIO.map((c, i) => [c, audio[i] || (checks.wasm && ADD_ON_CODECS.includes(c))])),
    encodeWebp: await ask(checks.canEncodeWebp),
  }
}
