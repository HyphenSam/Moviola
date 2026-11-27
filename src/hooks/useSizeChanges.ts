import { useEffect, useState } from 'react'
import { SIZED_CODECS, type SizeChanges } from '@/lib/frame-size'
import { videoTrack } from '@/lib/info'
import type { WorkerClient } from '@/lib/protocol'
import type { Source } from './useSource'

/** How the open file's first video track changes size as it plays (SPEC.md 6.1), checked in the worker
 * once per open: 'checking' until it answers, then what it found. Null when the size holds, the check
 * failed, or the codec's headers aren't read. Another file opening cancels the check. */
export function useSizeChanges(client: WorkerClient, source: Source | null): SizeChanges | 'checking' | null {
  const [found, setFound] = useState<{ sourceId: number; value: SizeChanges | null }>()
  const track = source && videoTrack(source.info)
  const trackId = track?.codec && SIZED_CODECS.includes(track.codec) ? track.id : null

  useEffect(() => {
    if (!source || trackId === null) return
    let live = true
    const scan = client.sizeChanges(source.file, trackId)
    const settle = (value: SizeChanges | null) => live && setFound({ sourceId: source.id, value })
    scan.result.then(settle, () => settle(null))
    return () => {
      live = false
      scan.cancel()
    }
  }, [client, source, trackId])

  if (!source || trackId === null) return null
  return found?.sourceId === source.id ? found.value : 'checking'
}
