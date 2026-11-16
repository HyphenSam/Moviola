import { useCallback, useEffect, useRef, useState } from 'react'
import { discard } from '@/lib/discard'
import { uniqueName } from '@/lib/names'
import { isImagePlan, type FramePlan, type JobPlan, type Plan } from '@/lib/plan'
import type { TargetSpec, WorkerClient } from '@/lib/protocol'

/** A result in the exports strip: downloadable (`url`), saved to disk, or failed (`error`). */
export type Export = {
  id: number
  name: string
  kind: JobPlan['kind']
  sourceSize: number
  /** Compress's results are checked against the source and the target (Plan `sizeCheck`). */
  sizeCheck?: Plan['sizeCheck']
} & ({ size: number; url: string | null; error?: never } | { error: string; size?: never; url?: never })

/**
 * Where the one job slot stands (SPEC.md section 7). Anything but `idle` holds the slot, so nothing
 * else can start:
 *
 *     idle → picking → running → idle (an export, made or failed)
 *     idle → copying → idle
 *     picking or running → cancelling → idle
 *
 * - `picking`: the save dialog is open and nothing has been sent to the worker.
 * - `running`: `doing` names the job for the progress bar ("Extracting"); `inMemory` says the save
 *   dialog couldn't be used, so the result is being built in memory instead.
 * - `copying`: a frame is on its way to the clipboard (Grab frame's Copy).
 * - `cancelling`: the job was told to stop, and the dialog or the worker hasn't answered yet.
 */
export type JobState =
  | { phase: 'idle' }
  | { phase: 'picking' }
  | { phase: 'running'; doing: string; name: string; fraction: number | null; startedAt: number; inMemory: boolean }
  | { phase: 'copying' }
  | { phase: 'cancelling' }

export type Running = Extract<JobState, { phase: 'running' }>

const IDLE: JobState = { phase: 'idle' }

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/** Chrome and Edge's save dialog; other browsers download from memory instead. */
const savePicker = () => (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker

/** Whether results stream to a file the user picks, rather than being held in memory. */
export const canSaveToDisk = () => !!savePicker()

const named = (error: unknown) => (error as { name?: unknown } | null)?.name
const worded = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The job slot (one job or copy at a time) and the exports strip. */
export function useJob(client: WorkerClient) {
  // The ref is the truth, read inside a click before React has rendered; `state` shows it.
  const slot = useRef<JobState>(IDLE)
  const [state, setState] = useState<JobState>(IDLE)
  const go = useCallback((next: JobState) => {
    slot.current = next
    setState(next)
  }, [])
  // Tells the worker to stop the running job.
  // Read through a function, so a check after an await isn't narrowed by one made before it.
  const phase = useCallback(() => slot.current.phase, [])
  const stop = useRef<(() => void) | null>(null)
  const [exports, setExports] = useState<Export[]>([])
  // What became of the last job, in a sentence for screen readers.
  const [note, setNote] = useState('')
  const nextExport = useRef(1)
  const latest = useRef(exports)
  latest.current = exports

  /** Starts a job. Call it straight from the click: the save dialog must open inside it. */
  const start = useCallback(
    async (file: File, plan: JobPlan, doing: string) => {
      if (slot.current.phase !== 'idle') return

      let name = uniqueName(
        plan.name,
        latest.current.map((e) => e.name),
      )
      /** Frees the slot and puts what became of the job on the strip. */
      const finish = (result: { size: number; url: string | null } | { error: string }) => {
        stop.current = null
        go(IDLE)
        const id = nextExport.current++
        const check = 'sizeCheck' in plan && plan.sizeCheck && { sizeCheck: plan.sizeCheck }
        setNote(
          'error' in result
            ? `${name} wasn’t made. ${result.error}`
            : result.url
              ? `${name} is ready to download.`
              : `Saved ${name}.`,
        )
        setExports((list) => [
          { id, name, kind: plan.kind, sourceSize: file.size, ...check, ...result } as Export,
          ...list,
        ])
      }

      let target: TargetSpec = { type: 'memory' }
      let inMemory = false
      // Images are small, so they're built in memory and downloaded (SPEC.md section 7).
      const picker = isImagePlan(plan) ? undefined : savePicker()
      if (picker) {
        go({ phase: 'picking' })
        const picked = await picker({
          suggestedName: plan.name,
          types: [
            {
              description: plan.kind === 'audio' ? 'Audio' : 'Video',
              accept: { [plan.mimeType]: [plan.name.slice(plan.name.lastIndexOf('.'))] },
            },
          ],
        }).then(
          (handle) => ({ handle }),
          (error: unknown) => ({ error }),
        )
        // Cancelled while the dialog was open: whatever the dialog answered, the job doesn't start.
        if (phase() !== 'picking') {
          if ('handle' in picked) void discard(picked.handle)
          return go(IDLE)
        }
        if ('handle' in picked) {
          target = { type: 'file', handle: picked.handle }
          name = picked.handle.name
        } else {
          const why = named(picked.error)
          // Closing the dialog cancels the job, quietly.
          if (why === 'AbortError') return go(IDLE)
          // These two mean the dialog can't be used here (a frame that isn't allowed it, a browser set
          // to refuse), and the result can still be built in memory. Anything else is a bug, such as
          // a name the dialog won't take, and falling back would hide it behind a job that fills memory.
          if (why !== 'SecurityError' && why !== 'NotAllowedError')
            return finish({ error: `The save dialog couldn’t be opened: ${worded(picked.error)}` })
          inMemory = true
        }
      }

      const job = client.run(file, plan, target, (fraction) => {
        if (slot.current.phase === 'running') go({ ...slot.current, fraction })
      })
      stop.current = job.cancel
      go({ phase: 'running', doing, name, fraction: null, startedAt: Date.now(), inMemory })

      job.result.then(
        // The worker's answer decides, even after Cancel: a job that finished before the cancel reached
        // it has saved its file, and the strip must say so.
        ({ size, blob }) => finish({ size, url: blob ? URL.createObjectURL(blob) : null }),
        (error: unknown) => {
          if (slot.current.phase === 'running') return finish({ error: worded(error) })
          // Cancelled: nothing is added, and the worker has discarded what it wrote.
          stop.current = null
          go(IDLE)
        },
      )
    },
    [client, go],
  )

  /** Stops the job, whether its save dialog is still open or it's running. The slot is freed when the
   * dialog or the worker answers, not before: until then the job may still be writing. */
  const cancel = useCallback(() => {
    const { phase } = slot.current
    if (phase !== 'picking' && phase !== 'running') return
    go({ phase: 'cancelling' })
    stop.current?.()
    stop.current = null
  }, [go])

  /** Grabs a frame for the clipboard, in the job slot so that it never runs beside a job or another
   * copy. `write` is given the image's promise and puts it on the clipboard; call this straight from
   * the click, so the write starts inside it. Returns the write's promise, or null if the slot was taken. */
  const copy = useCallback(
    (file: File, plan: FramePlan, write: (image: Promise<Blob>) => Promise<unknown>) => {
      if (slot.current.phase !== 'idle') return null
      go({ phase: 'copying' })
      const image = client.run(file, plan, { type: 'memory' }).result.then(({ blob }) => blob!)
      let written: Promise<unknown>
      try {
        written = write(image)
      } catch (error) {
        written = Promise.reject(error)
      }
      // The clipboard can refuse while the worker is still drawing: wait for both.
      void Promise.allSettled([image, written]).then(() => go(IDLE))
      return written
    },
    [client, go],
  )

  /** Takes a result off the strip and frees the memory it held. */
  const remove = useCallback((id: number) => {
    const gone = latest.current.find((e) => e.id === id)
    if (gone?.url) URL.revokeObjectURL(gone.url)
    setExports((list) => list.filter((e) => e.id !== id))
  }, [])

  useEffect(() => () => latest.current.forEach((e) => e.url && URL.revokeObjectURL(e.url)), [])

  // While a job runs, leaving the page asks first (SPEC.md section 7).
  const running = state.phase === 'running'
  useEffect(() => {
    if (!running) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [running])

  return { state, exports, note, start, cancel, copy, remove }
}
