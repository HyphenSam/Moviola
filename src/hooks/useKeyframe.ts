import { useEffect, useState } from 'react'
import type { WorkerClient } from '@/lib/protocol'

// Long enough that dragging a handle or typing asks once, at the end.
const DELAY = 250

/** The keyframe a fast trim from `time` starts on, looked up in the worker once `time` stops changing.
 * Null until it's known, and while there's nothing to look up (no `file`). */
export function useKeyframe(client: WorkerClient, file: File | null, trackId: number | null, time: number) {
  const [found, setFound] = useState<{ file: File; trackId: number; time: number; keyframe: number | null }>()

  useEffect(() => {
    if (!file || trackId === null) return
    let live = true
    const timer = setTimeout(() => {
      client.keyframe(file, trackId, time).then(
        (keyframe) => live && setFound({ file, trackId, time, keyframe }),
        () => {},
      )
    }, DELAY)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [client, file, trackId, time])

  return found && found.file === file && found.trackId === trackId && found.time === time ? found.keyframe : null
}
