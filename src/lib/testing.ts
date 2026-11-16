// Fakes for tests: the worker client, MediaInfo builders and the frame preview. Fakes over mocks
// (CLAUDE.md): each behaves like the real thing in the ways the tests rely on.
import type { Frame, FrameSource, OpenFrames } from '@/media/frames'
import type { Capabilities } from './capabilities'
import type { AudioTrack, MediaInfo, VideoTrack } from './info'
import type { JobPlan } from './plan'
import type { RunResult, Size, TargetSpec, WorkerCapabilities, WorkerClient } from './protocol'

/** A browser that can encode everything and save to disk. Tests take away what they need missing. */
export const ALL_CAPABLE: Capabilities = {
  saveToDisk: true,
  encodeVideo: { avc: true, hevc: true, vp9: true, av1: true },
  encodeAudio: { aac: true, opus: true, mp3: true, flac: true },
  encodeWebp: true,
}

export function fakeVideoTrack(over: Partial<VideoTrack> = {}): VideoTrack {
  return {
    kind: 'video',
    id: 1,
    codec: 'avc',
    codecString: 'avc1.640028',
    language: null,
    name: null,
    isDefault: true,
    bitrate: 4_000_000,
    canDecode: true,
    width: 1920,
    height: 1080,
    rotation: 0,
    frameRate: 25,
    reordered: false,
    colour: { hdr: false },
    ...over,
  }
}

export function fakeAudioTrack(over: Partial<AudioTrack> = {}): AudioTrack {
  return {
    kind: 'audio',
    id: 2,
    codec: 'aac',
    codecString: 'mp4a.40.2',
    language: null,
    name: null,
    isDefault: true,
    bitrate: 128_000,
    canDecode: true,
    sampleRate: 48000,
    channels: 2,
    bitDepth: null,
    ...over,
  }
}

/** A 1080p H.264 + AAC MP4, 1:23.5 long, unless told otherwise. */
export function fakeInfo(over: Partial<MediaInfo> = {}): MediaInfo {
  return {
    name: 'holiday.mp4',
    size: 12_345_678,
    container: 'mp4',
    mimeType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
    start: 0,
    duration: 83.5,
    tags: {},
    tracks: [fakeVideoTrack(), fakeAudioTrack()],
    ...over,
  }
}

export const fakeAudioInfo = (over: Partial<MediaInfo> = {}) =>
  fakeInfo({
    name: 'song.m4a',
    mimeType: 'audio/mp4; codecs="mp4a.40.2"',
    tracks: [fakeAudioTrack({ id: 1 })],
    ...over,
  })

/** A job the fake client was asked to run; the test moves it along. */
export type FakeJob = {
  file: File
  plan: JobPlan
  target: TargetSpec
  cancelled: boolean
  progress(fraction: number | null): void
  finish(result: RunResult): void
  fail(message: string): void
}

/** A worker client whose probe answers with `probe(file)`; throwing (or rejecting) is a failed probe.
 * It can encode what `capabilities` says: everything, unless told otherwise; at a size other than
 * 1080p, what `encodable(size)` says (the same, unless told otherwise). Keyframes fall every 2 s,
 * as in the fixtures; thumbnails come back blank (jsdom can't draw). `keyframes` and `thumbnailed`
 * list what was asked. Runs wait in `jobs` until the test finishes or fails them; cancelling rejects
 * as the worker does, unless `holdCancels` is set: then a cancelled job waits for the test to settle
 * it, like a worker that hasn't answered yet (and may answer that the job finished after all). */
export function fakeClient(
  probe: (file: File) => MediaInfo | Promise<MediaInfo>,
  capabilities: WorkerCapabilities = ALL_CAPABLE,
  encodable: (size: Size) => Capabilities['encodeVideo'] = () => capabilities.encodeVideo,
): WorkerClient & {
  probed: File[]
  jobs: FakeJob[]
  keyframes: { file: File; trackId: number; time: number }[]
  thumbnailed: { file: File; times: number[]; height: number }[]
  holdCancels: boolean
} {
  const probed: File[] = []
  const jobs: FakeJob[] = []
  const keyframes: { file: File; trackId: number; time: number }[] = []
  const thumbnailed: { file: File; times: number[]; height: number }[] = []
  const client: ReturnType<typeof fakeClient> = {
    probed,
    jobs,
    keyframes,
    thumbnailed,
    holdCancels: false,
    capabilities: async () => ({
      encodeVideo: capabilities.encodeVideo,
      encodeAudio: capabilities.encodeAudio,
      encodeWebp: capabilities.encodeWebp,
    }),
    encodable: async (size) => encodable(size),
    keyframe: async (file, trackId, time) => {
      keyframes.push({ file, trackId, time })
      return Math.floor(time / 2) * 2
    },
    thumbnails: async (file, times, height) => {
      thumbnailed.push({ file, times, height })
      return times.map(() => null)
    },
    probe: async (file) => {
      probed.push(file)
      return probe(file)
    },
    run: (file, plan, target, onProgress) => {
      const result = deferred<RunResult>()
      const job: FakeJob = {
        file,
        plan,
        target,
        cancelled: false,
        progress: (fraction) => onProgress?.(fraction),
        finish: result.resolve,
        fail: (message) => result.reject(new Error(message)),
      }
      jobs.push(job)
      return {
        result: result.promise,
        cancel: () => {
          job.cancelled = true
          if (!client.holdCancels) result.reject(new Error('Cancelled.'))
        },
      }
    },
  }
  return client
}

/** Frames for the file card and the fallback preview. jsdom can't draw, so each frame is a blank
 * stand-in at 25 fps; `opened` lists the files asked for, `asked` the times of single frames asked
 * for, `disposed` counts the ones let go. */
export function fakeFrames(): OpenFrames & { opened: File[]; asked: number[]; disposed: number } {
  const frame = (t: number): Frame => ({
    image: { width: 320, height: 180 } as Frame['image'],
    timestamp: Math.floor(t * 25) / 25,
    duration: 0.04,
  })
  const open = Object.assign(
    (file: File): FrameSource => {
      open.opened.push(file)
      return {
        frameAt: async (t) => (open.asked.push(t), frame(t)),
        framesFrom: async function* (t) {
          for (let i = 0; i < 3; i++) yield frame(t + i * 0.04)
        },
        dispose: () => void open.disposed++,
      }
    },
    { opened: [] as File[], asked: [] as number[], disposed: 0 },
  )
  return open
}

/** A promise the test settles when it chooses. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
