import { useCallback, useRef, useState } from 'react'
import type { MediaInfo } from '@/lib/info'
import type { WorkerClient } from '@/lib/protocol'

/** `id` is new for every open, so views keyed by it start afresh even for the same file again. */
export type Source = { id: number; file: File; info: MediaInfo }

/** The open file and its info. Opening probes in the worker; if that fails, the previous file stays
 * open and `error` says why. */
export function useSource(client: WorkerClient) {
  const [source, setSource] = useState<Source | null>(null)
  const [opening, setOpening] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Only the latest open counts; a slow probe that a newer file overtook is dropped.
  const latest = useRef(0)

  const open = useCallback(
    (file: File) => {
      const ticket = ++latest.current
      // The last file's error is old news once another is opening; they'd read as one story.
      setError(null)
      setOpening(file)
      client.probe(file).then(
        (info) => {
          if (ticket !== latest.current) return
          setSource({ id: ticket, file, info })
          setOpening(null)
        },
        (e: unknown) => {
          if (ticket !== latest.current) return
          setError(e instanceof Error ? e.message : String(e))
          setOpening(null)
        },
      )
    },
    [client],
  )

  /** Drops a file that is still opening; the one already open stays. */
  const cancelOpening = useCallback(() => {
    latest.current++
    setOpening(null)
  }, [])

  const dismissError = useCallback(() => setError(null), [])

  return { source, opening, error, open, cancelOpening, dismissError }
}
