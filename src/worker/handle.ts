import { isImagePlan, type FramePlan, type GifPlan, type Plan } from '@/lib/plan'
import type { Reply, Request, TargetSpec } from '@/lib/protocol'
import { capabilities, encodableAt } from '@/media/encoders'
import { thumbnails } from '@/media/frames'
import { grabFrame, makeGif } from '@/media/images'
import { keyframeAt, probe } from '@/media/probe'
import { JobProblem, run } from '@/media/run'

/** Jobs running now, by request id, so a cancel can reach them. */
const running = new Map<number, AbortController>()

/** Runs one request and posts its replies. Kept apart from the worker's global scope so Node tests
 * can call it directly. */
export async function handle(request: Request, post: (reply: Reply, transfer?: Transferable[]) => void): Promise<void> {
  try {
    switch (request.type) {
      case 'probe':
        post({ type: 'done', id: request.id, value: await probe(request.file) })
        break
      case 'capabilities':
        post({ type: 'done', id: request.id, value: await capabilities() })
        break
      case 'encodable':
        post({ type: 'done', id: request.id, value: await encodableAt(request.size) })
        break
      case 'keyframe':
        post({ type: 'done', id: request.id, value: await keyframeAt(request.file, request.trackId, request.time) })
        break
      case 'thumbnails': {
        const images = await thumbnails(request.file, request.times, request.height)
        post(
          { type: 'done', id: request.id, value: images },
          images.filter((i) => i !== null),
        )
        break
      }
      case 'cancel':
        running.get(request.id)?.abort()
        break
      case 'run': {
        // Registered before anything is awaited, so a cancel sent straight after always finds it.
        const controller = new AbortController()
        running.set(request.id, controller)
        try {
          post({ type: 'progress', id: request.id, fraction: null })
          const onProgress = (fraction: number) => post({ type: 'progress', id: request.id, fraction })
          const { file, plan } = request
          const result = isImagePlan(plan)
            ? await runImage(file, plan, controller.signal, onProgress)
            : await runTo(request.target, { file, plan }, controller.signal, onProgress)
          post({ type: 'done', id: request.id, value: result })
        } finally {
          running.delete(request.id)
        }
        break
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const worded = request.type !== 'run' || error instanceof JobProblem
    post({ type: 'failed', id: request.id, message: worded ? message : `Something went wrong: ${message}` })
  }
}

async function runTo(
  target: TargetSpec,
  { file, plan }: { file: File; plan: Plan },
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
) {
  // Mediabunny reports progress far more often than a bar can show; a step of 0.5% is plenty.
  let last = -1
  const progress = (fraction: number) => {
    const step = Math.floor(fraction * 200)
    if (step === last) return
    last = step
    onProgress(fraction)
  }

  if (target.type === 'memory') {
    const result = await run(file, plan, null, { signal, onProgress: progress })
    return { size: result.size, blob: new Blob([result.buffer!], { type: plan.mimeType }) }
  }

  const writable = await target.handle.createWritable()
  try {
    const result = await run(file, plan, writable, { signal, onProgress: progress })
    return { size: result.size, blob: null }
  } catch (error) {
    await discard(target.handle)
    throw error
  }
}

/** Images are small, so they're always built in memory (SPEC.md section 7). */
async function runImage(
  file: File,
  plan: FramePlan | GifPlan,
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
) {
  const blob = plan.kind === 'frame' ? await grabFrame(file, plan) : await makeGif(file, plan, { signal, onProgress })
  return { size: blob.size, blob }
}

/** The save dialog makes an empty file at once. If the job never wrote it, remove it, so a cancelled
 * job leaves nothing behind. A file the user chose to replace still holds its old contents (the
 * stream was aborted) and is left alone. `remove()` is Chrome's; elsewhere the empty file stays. */
async function discard(handle: FileSystemFileHandle) {
  try {
    const removable = handle as FileSystemFileHandle & { remove?: () => Promise<void> }
    if ((await handle.getFile()).size === 0) await removable.remove?.()
  } catch {
    // Nothing more can be done; the job's failure is what the user needs to hear about.
  }
}
