import { useCallback, useState } from 'react'

/** A value that belongs to one open file: `undefined` until it's set for that file, and again once
 * another file opens (each open has its own id), so the caller's default applies. Setting it with no
 * file open does nothing. */
export function usePerSource<T>(source: { id: number } | null) {
  const [held, setHeld] = useState<{ sourceId: number; value: T } | null>(null)
  const sourceId = source?.id
  const value = held && held.sourceId === sourceId ? held.value : undefined
  const set = useCallback((value: T) => sourceId != null && setHeld({ sourceId, value }), [sourceId])
  return [value, set] as const
}
