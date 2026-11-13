import type { Capabilities } from './capabilities'
import type { MediaInfo } from './info'
import type { Plan } from './plan'

/** Where a job's output goes: a file the user chose in the save dialog, streamed to disk, or memory,
 * returned as a Blob to download (SPEC.md section 7). */
export type TargetSpec = { type: 'file'; handle: FileSystemFileHandle } | { type: 'memory' }

/** A finished job: its size, and its bytes when it was built in memory. */
export type RunResult = { size: number; blob: Blob | null }

// Messages between the page and the worker (SPEC.md section 7). Files cross by structured clone,
// which copies a handle to the file, not its bytes.
export type Request =
  | { type: 'probe'; id: number; file: File }
  | { type: 'capabilities'; id: number }
  | { type: 'run'; id: number; file: File; plan: Plan; target: TargetSpec }
  | { type: 'cancel'; id: number }

export type Reply =
  | { type: 'progress'; id: number; fraction: number | null } // null = indeterminate
  | { type: 'done'; id: number; value: unknown }
  | { type: 'failed'; id: number; message: string }

export type WorkerCapabilities = Omit<Capabilities, 'saveToDisk'>

/** A running job. Cancelling makes `result` reject once the worker has stopped. */
export type Job = { result: Promise<RunResult>; cancel(): void }

/** What the page asks of the worker. App takes one as a prop, so tests pass a fake. */
export type WorkerClient = {
  probe(file: File): Promise<MediaInfo>
  /** What this browser can encode; the page adds `saveToDisk`. */
  capabilities(): Promise<WorkerCapabilities>
  run(file: File, plan: Plan, target: TargetSpec, onProgress?: (fraction: number | null) => void): Job
}

/** The parts of a Worker the client uses. */
export type Port = {
  postMessage(message: Request): void
  addEventListener(type: 'message', listener: (event: { data: Reply }) => void): void
}

type Waiting = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  onProgress?: (fraction: number | null) => void
}

/** A promise-based client: each request gets an id, and the reply with that id settles it. */
export function createClient(port: Port): WorkerClient {
  let nextId = 1
  const pending = new Map<number, Waiting>()

  port.addEventListener('message', ({ data }) => {
    const waiting = pending.get(data.id)
    if (!waiting) return
    if (data.type === 'progress') return waiting.onProgress?.(data.fraction)
    pending.delete(data.id)
    if (data.type === 'done') waiting.resolve(data.value)
    else waiting.reject(new Error(data.message))
  })

  function send<T>(request: Request, onProgress?: Waiting['onProgress']): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject, onProgress })
      port.postMessage(request)
    })
  }

  return {
    probe: (file) => send<MediaInfo>({ type: 'probe', id: nextId++, file }),
    capabilities: () => send<WorkerCapabilities>({ type: 'capabilities', id: nextId++ }),
    run: (file, plan, target, onProgress) => {
      const id = nextId++
      return {
        result: send<RunResult>({ type: 'run', id, file, plan, target }, onProgress),
        cancel: () => port.postMessage({ type: 'cancel', id }),
      }
    },
  }
}
