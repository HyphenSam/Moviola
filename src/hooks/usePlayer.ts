import { useCallback, useMemo, useRef, useState } from 'react'
import { readVolume, writeVolume } from '@/lib/settings'

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

/** The playhead and transport state, shared by whichever backend is showing the file. Backends
 * register themselves and report what happens; the transport and keys call the controls. */
export function usePlayer(duration: number, frameRate: number | null) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolumeState] = useState(() => readVolume(storage()))
  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    writeVolume(storage(), v)
  }, [])
  const backend = useRef<Backend | null>(null)
  // The latest values, for controls called between renders (keys pressed in quick succession).
  const now = useRef({ time: 0, playing: false })

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
  /** One frame back or forward, paused (frame rate unknown: assume 30). */
  const step = useCallback(
    (frames: number) => {
      pause()
      seek(now.current.time + frames / (frameRate ?? 30))
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
