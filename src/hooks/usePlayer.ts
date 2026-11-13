import { useCallback, useMemo, useRef, useState } from 'react'
import { readMuted, readVolume, writeMuted, writeVolume } from '@/lib/settings'
import { stepFrames } from '@/lib/timecode'

/** `localStorage`, or null where reading the property itself throws (blocked site data). */
function storage() {
  try {
    return localStorage
  } catch {
    return null
  }
}

/** What actually plays: a media element, or decoded frames drawn on a canvas. */
export type Backend = { play(): void; pause(): void; seek(time: number): void }

/** The playhead and transport state, shared by whichever backend is showing the file and the tools
 * that use the playhead. Backends register themselves and report what happens; the transport, the
 * timeline and keys call the controls. A new `file` starts back at 0, paused. */
export function usePlayer(file: unknown, duration: number, frameRate: number | null) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  // The latest values, for controls called between renders (keys pressed in quick succession).
  const now = useRef({ time: 0, playing: false })
  // Reset while rendering, not in an effect: the new file's backend reads `now` as it mounts.
  const [shown, setShown] = useState(file)
  if (shown !== file) {
    setShown(file)
    setTime(0)
    setPlaying(false)
    now.current = { time: 0, playing: false }
  }
  const [muted, setMutedState] = useState(() => readMuted(storage()))
  const setMuted = useCallback((m: boolean) => {
    setMutedState(m)
    writeMuted(storage(), m)
  }, [])
  const [volume, setVolumeState] = useState(() => readVolume(storage()))
  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    writeVolume(storage(), v)
  }, [])
  const backend = useRef<Backend | null>(null)

  const report = useMemo(
    () => ({
      time(t: number) {
        now.current.time = t
        setTime(t)
      },
      playing(p: boolean) {
        now.current.playing = p
        setPlaying(p)
      },
    }),
    [],
  )

  const seek = useCallback(
    (t: number) => {
      const clamped = Math.min(Math.max(0, t), duration)
      report.time(clamped)
      backend.current?.seek(clamped)
    },
    [duration, report],
  )
  const play = useCallback(() => backend.current?.play(), [])
  const pause = useCallback(() => backend.current?.pause(), [])
  const toggle = useCallback(() => (now.current.playing ? pause() : play()), [play, pause])
  const nudge = useCallback((seconds: number) => seek(now.current.time + seconds), [seek])
  /** Frames back or forward from the frame showing, paused (frame rate unknown: assume 30). */
  const step = useCallback(
    (frames: number) => {
      pause()
      seek(stepFrames(now.current.time, frames, frameRate))
    },
    [pause, seek, frameRate],
  )

  return {
    time,
    duration,
    playing,
    muted,
    volume,
    now,
    backend,
    report,
    play,
    pause,
    toggle,
    seek,
    nudge,
    step,
    setMuted,
    setVolume,
  }
}

export type PlayerControls = ReturnType<typeof usePlayer>
