import { useCallback, useEffect, useRef, useState } from 'react'
import { uniqueName } from '@/lib/names'
import { isImagePlan, type JobPlan, type Plan } from '@/lib/plan'
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

/** `doing` names the job for the progress bar: "Extracting". */
export type Running = { doing: string; name: string; fraction: number | null; startedAt: number }

type SaveFilePicker = (options: {
  suggestedName: string
  types: { description: string; accept: Record<string, string[]> }[]
}) => Promise<FileSystemFileHandle>

/** Chrome and Edge's save dialog; other browsers download from memory instead. */
const savePicker = () => (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker

/** Whether results stream to a file the user picks, rather than being held in memory. */
export const canSaveToDisk = () => !!savePicker()

/** The running job (one at a time) and the exports strip. */
export function useJob(client: WorkerClient) {
  const [running, setRunning] = useState<Running | null>(null)
  const [exports, setExports] = useState<Export[]>([])
  // What became of the last job, in a sentence for screen readers.
  const [note, setNote] = useState('')
  // The running job's ticket: replies for any other ticket are from a job that was cancelled.
  const current = useRef<{ ticket: number; cancel: () => void } | null>(null)
  const tickets = useRef(0)
  const nextExport = useRef(1)
  const latest = useRef(exports)
  latest.current = exports

  /** Starts a job. Call it straight from the click: the save dialog must open inside it. */
  const start = useCallback(
    async (file: File, plan: JobPlan, doing: string) => {
      if (current.current) return
      const ticket = ++tickets.current
      // Hold the slot while the dialog is open, so a second click can't start another job.
      current.current = { ticket, cancel: () => {} }

      let target: TargetSpec = { type: 'memory' }
      let name = uniqueName(
        plan.name,
        latest.current.map((e) => e.name),
      )
      // Images are small, so they're built in memory and downloaded (SPEC.md section 7).
      const picker = isImagePlan(plan) ? undefined : savePicker()
      if (picker) {
        try {
          const handle = await picker({
            suggestedName: plan.name,
            types: [
              {
                description: plan.kind === 'audio' ? 'Audio' : 'Video',
                accept: { [plan.mimeType]: [plan.name.slice(plan.name.lastIndexOf('.'))] },
              },
            ],
          })
          target = { type: 'file', handle }
          name = handle.name
        } catch (error) {
          // Cancelling the dialog cancels the job, quietly. If the dialog fails for another reason,
          // the result can still be built in memory and downloaded.
          if (error instanceof DOMException && error.name === 'AbortError') {
            current.current = null
            return
          }
        }
      }

      const job = client.run(file, plan, target, (fraction) => {
        if (current.current?.ticket === ticket) setRunning((r) => r && { ...r, fraction })
      })
      current.current = { ticket, cancel: job.cancel }
      setRunning({ doing, name, fraction: null, startedAt: Date.now() })

      const settle = (result: Omit<Export, 'id' | 'name' | 'kind' | 'sourceSize' | 'sizeCheck'>) => {
        if (current.current?.ticket !== ticket) return
        current.current = null
        setRunning(null)
        const id = nextExport.current++
        const check = 'sizeCheck' in plan && plan.sizeCheck && { sizeCheck: plan.sizeCheck }
        setNote(
          result.error !== undefined
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
      job.result.then(
        ({ size, blob }) => settle({ size, url: blob ? URL.createObjectURL(blob) : null }),
        (error: unknown) => settle({ error: error instanceof Error ? error.message : String(error) }),
      )
    },
    [client],
  )

  /** Stops the running job. Nothing is added to the exports; the worker discards what it wrote. */
  const cancel = useCallback(() => {
    current.current?.cancel()
    current.current = null
    setRunning(null)
  }, [])

  /** Takes a result off the strip and frees the memory it held. */
  const remove = useCallback((id: number) => {
    const gone = latest.current.find((e) => e.id === id)
    if (gone?.url) URL.revokeObjectURL(gone.url)
    setExports((list) => list.filter((e) => e.id !== id))
  }, [])

  useEffect(() => () => latest.current.forEach((e) => e.url && URL.revokeObjectURL(e.url)), [])

  // While a job runs, leaving the page asks first (SPEC.md section 7).
  useEffect(() => {
    if (!running) return
    const ask = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', ask)
    return () => window.removeEventListener('beforeunload', ask)
  }, [running])

  return { running, exports, note, start, cancel, remove }
}
