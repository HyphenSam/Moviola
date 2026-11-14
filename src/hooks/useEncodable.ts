import { useEffect, useState } from 'react'
import type { Capabilities } from '@/lib/capabilities'
import type { Size, WorkerClient } from '@/lib/protocol'

/** Which video codecs this browser can encode at `size` (null for no question), asked of the worker
 * once per size; null until it answers. */
export function useEncodable(client: WorkerClient, size: Size | null): Capabilities['encodeVideo'] | null {
  const key = size ? `${size.width}x${size.height}` : null
  const [answers, setAnswers] = useState<Record<string, Capabilities['encodeVideo']>>({})
  const known = key !== null && key in answers
  useEffect(() => {
    if (!size || !key || known) return
    let live = true
    client.encodable(size).then(
      (encoders) => live && setAnswers((a) => ({ ...a, [key]: encoders })),
      () => {},
    )
    return () => {
      live = false
    }
    // `size` is described fully by `key`.
  }, [client, key, known])
  return key ? (answers[key] ?? null) : null
}
