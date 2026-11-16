import { useEffect, useState } from 'react'
import type { Capabilities } from '@/lib/capabilities'
import type { Size, WorkerClient } from '@/lib/protocol'

/**
 * Which video codecs this browser can encode at `size` (null for no question), asked of the worker
 * once per size. Each size is unknown, known or failed:
 *
 * - unknown: `pending` is true from the first render, so nothing can start on a stand-in answer.
 * - known: `encoders` is the answer, kept for the session.
 * - failed: `encoders` is null and `pending` false; the question is asked again when `retryOn`
 *   changes (pass something that changes with the user's settings, and only then).
 */
export function useEncodable(
  client: WorkerClient,
  size: Size | null,
  retryOn: unknown,
): { encoders: Capabilities['encodeVideo'] | null; pending: boolean } {
  const key = size ? `${size.width}x${size.height}` : null
  const [answers, setAnswers] = useState<Record<string, Capabilities['encodeVideo']>>({})
  const [failed, setFailed] = useState<{ key: string; on: unknown } | null>(null)
  const known = key !== null && key in answers
  const gaveUp = failed !== null && failed.key === key && failed.on === retryOn
  useEffect(() => {
    if (!size || !key || known || gaveUp) return
    let live = true
    client.encodable(size).then(
      (encoders) => live && setAnswers((a) => ({ ...a, [key]: encoders })),
      () => live && setFailed({ key, on: retryOn }),
    )
    return () => {
      live = false
    }
    // `size` is described fully by `key`, and `retryOn` matters only through `gaveUp`.
  }, [client, key, known, gaveUp])
  return { encoders: key ? (answers[key] ?? null) : null, pending: key !== null && !known && !gaveUp }
}
