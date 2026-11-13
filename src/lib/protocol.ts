import type { MediaInfo } from './info'

// Messages between the page and the worker (SPEC.md section 7). Files cross by structured clone,
// which copies a handle to the file, not its bytes.
export type Request = { type: 'probe'; id: number; file: File }

export type Reply =
  | { type: 'progress'; id: number; fraction: number | null } // null = indeterminate
  | { type: 'done'; id: number; value: unknown }
  | { type: 'failed'; id: number; message: string }

/** What the page asks of the worker. App takes one as a prop, so tests pass a fake. */
export type WorkerClient = {
  probe(file: File): Promise<MediaInfo>
}

/** The parts of a Worker the client uses. */
export type Port = {
  postMessage(message: Request): void
  addEventListener(type: 'message', listener: (event: { data: Reply }) => void): void
}

/** A promise-based client: each request gets an id, and the reply with that id settles it. */
export function createClient(port: Port): WorkerClient {
  let nextId = 1
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()

  port.addEventListener('message', ({ data }) => {
    const waiting = pending.get(data.id)
    if (!waiting || data.type === 'progress') return
    pending.delete(data.id)
    if (data.type === 'done') waiting.resolve(data.value)
    else waiting.reject(new Error(data.message))
  })

  function send<T>(request: Omit<Request, 'id'>): Promise<T> {
    const id = nextId++
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject })
      port.postMessage({ ...request, id } as Request)
    })
  }

  return {
    probe: (file) => send<MediaInfo>({ type: 'probe', file }),
  }
}
