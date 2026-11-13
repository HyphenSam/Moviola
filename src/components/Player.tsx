import { AudioLines, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePlayer, type PlayerControls } from '@/hooks/usePlayer'
import { videoTrack, type MediaInfo } from '@/lib/info'
import { shortcutFor } from '@/lib/shortcuts'
import { formatDuration } from '@/lib/timecode'
import type { FrameSource, OpenFrames } from '@/media/frames'
import { Transport } from './Transport'

// The fallback preview's frames fit this box; plenty for judging the picture, quick to decode.
const PREVIEW_BOX = { width: 1280, height: 720 }

/** Shows the open file (SPEC.md section 5). Native playback first, since it brings sound and smooth
 * seeking; if the browser can't play the file, decoded frames without sound; if it can't decode the
 * video either, a sentence saying so. Render it with a `key` per file so each file starts afresh. */
export function Player({ file, info, frames }: { file: File; info: MediaInfo; frames: OpenFrames }) {
  const video = videoTrack(info)
  const [mode, setMode] = useState<'native' | 'frames' | 'none'>('native')
  const player = usePlayer(info.duration, video?.frameRate ?? null)
  const { report } = player

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { key, shiftKey, ctrlKey, metaKey, altKey } = e
      const target = e.target instanceof HTMLElement ? e.target : null
      const shortcut = shortcutFor({ key, shiftKey, ctrlKey, metaKey, altKey, target })
      if (!shortcut || mode === 'none') return
      e.preventDefault()
      if (shortcut.type === 'toggle') player.toggle()
      else if (shortcut.type === 'nudge') player.nudge(shortcut.seconds)
      else player.seek(shortcut.type === 'start' ? 0 : info.duration)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, mode, info.duration])

  function unsupported() {
    report.playing(false)
    setMode(video?.canDecode ? 'frames' : 'none')
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex items-center justify-center">
          {!video ? (
            <AudioPanel info={info}>
              {mode === 'native' ? (
                <NativeMedia kind="audio" file={file} player={player} onUnsupported={unsupported} />
              ) : null}
            </AudioPanel>
          ) : mode === 'native' ? (
            <NativeMedia kind="video" file={file} player={player} onUnsupported={unsupported} />
          ) : mode === 'frames' ? (
            <FrameView file={file} frames={frames} player={player} />
          ) : (
            <Unavailable icon={<VideoOff />}>
              This browser can’t show this video, but copying tools still work.
            </Unavailable>
          )}
        </div>
        {mode === 'frames' && (
          <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2.5 py-1 text-xs text-stage-ink backdrop-blur-sm">
            Preview without sound
          </span>
        )}
      </div>
      {mode !== 'none' && <Transport player={player} frameSteps={!!video} sound={mode === 'native'} />}
    </div>
  )
}

/** A `<video>` or `<audio>` on an object URL of the file: the browser reads it lazily, never whole. */
function NativeMedia({
  kind,
  file,
  player,
  onUnsupported,
}: {
  kind: 'video' | 'audio'
  file: File
  player: PlayerControls
  onUnsupported: () => void
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [url, setUrl] = useState<string>()
  const { report, backend, playing, muted, volume } = player
  const failed = useRef(onUnsupported)
  failed.current = onUnsupported

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  useEffect(() => {
    const el = ref.current!
    el.currentTime = player.now.current.time
    backend.current = {
      play: () => void el.play().catch(() => {}),
      pause: () => el.pause(),
      seek: (t) => (el.currentTime = t),
    }
    const time = () => report.time(el.currentTime)
    const on = { play: () => report.playing(true), pause: () => report.playing(false) }
    // Some browsers play a file's sound but can't decode its picture; that's no preview either.
    const loaded = () => kind === 'video' && el.videoWidth === 0 && failed.current()
    const error = () => failed.current()
    el.addEventListener('play', on.play)
    el.addEventListener('pause', on.pause)
    el.addEventListener('ended', on.pause)
    el.addEventListener('timeupdate', time)
    el.addEventListener('seeked', time)
    el.addEventListener('loadedmetadata', loaded)
    el.addEventListener('error', error)
    return () => {
      backend.current = null
      el.removeEventListener('play', on.play)
      el.removeEventListener('pause', on.pause)
      el.removeEventListener('ended', on.pause)
      el.removeEventListener('timeupdate', time)
      el.removeEventListener('seeked', time)
      el.removeEventListener('loadedmetadata', loaded)
      el.removeEventListener('error', error)
    }
  }, [backend, report, kind, player.now])

  useEffect(() => {
    ref.current!.muted = muted
    ref.current!.volume = volume
  }, [muted, volume])

  // timeupdate comes a few times a second; follow the playhead every frame while playing.
  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      if (ref.current) report.time(ref.current.currentTime)
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, report])

  if (kind === 'audio') return <audio ref={ref} src={url} preload="auto" />
  return <video ref={ref} src={url} preload="auto" playsInline className="h-full w-full object-contain" />
}

/** Decoded frames drawn on a canvas at the playhead; playing draws each frame at its time, or as
 * soon as it's decoded when decoding can't keep up. */
function FrameView({ file, frames, player }: { file: File; frames: OpenFrames; player: PlayerControls }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { report, backend, now, duration } = player

  useEffect(() => {
    const source: FrameSource = frames(file, PREVIEW_BOX)
    // Each seek or play bumps this, so a slower earlier draw or loop gives way to the newest.
    let generation = 0

    const draw = (image: CanvasImageSource & { width: number; height: number }) => {
      const c = canvas.current
      if (!c) return
      if (c.width !== image.width || c.height !== image.height) {
        c.width = image.width
        c.height = image.height
      }
      c.getContext('2d')?.drawImage(image, 0, 0)
    }

    const show = async (t: number) => {
      const mine = ++generation
      const frame = await source.frameAt(t)
      if (frame && mine === generation) draw(frame.image)
    }

    const run = async (from: number) => {
      const mine = ++generation
      report.playing(true)
      const start = performance.now()
      for await (const frame of source.framesFrom(from)) {
        if (mine !== generation) return
        const wait = start + (frame.timestamp - from) * 1000 - performance.now()
        if (wait > 0) await new Promise((r) => setTimeout(r, wait))
        if (mine !== generation) return
        draw(frame.image)
        report.time(frame.timestamp)
      }
      if (mine === generation) report.playing(false)
    }

    // Reads still pending when the source is disposed (a new file, or StrictMode's second run) fail;
    // nothing is waiting for them. A frame that can't be decoded just stops playing.
    const stopped = () => report.playing(false)
    backend.current = {
      play: () => void run(now.current.time >= duration - 0.01 ? 0 : now.current.time).catch(stopped),
      pause: () => {
        generation++
        stopped()
      },
      seek: (t) => void (now.current.playing ? run(t).catch(stopped) : show(t).catch(() => {})),
    }
    void show(now.current.time).catch(() => {})
    return () => {
      generation++
      backend.current = null
      source.dispose()
    }
  }, [file, frames, backend, report, now, duration])

  return <canvas ref={canvas} className="h-full w-full object-contain" />
}

function AudioPanel({ info, children }: { info: MediaInfo; children: React.ReactNode }) {
  return (
    <div className="flex max-w-full flex-col items-center gap-2 px-6 text-center">
      <AudioLines aria-hidden="true" className="size-6 text-stage-ink-soft" strokeWidth={1.75} />
      <h2 className="max-w-full truncate text-lg leading-snug font-semibold text-stage-ink">{info.name}</h2>
      <p className="text-[13px] text-stage-ink-soft">{formatDuration(info.duration)}</p>
      {children ?? (
        <p className="max-w-sm text-[13px] text-stage-ink-soft">
          This browser can’t play this audio, but the tools still work.
        </p>
      )}
    </div>
  )
}

function Unavailable({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 text-center">
      {/* The thumbnail strip's placeholder, until the strip exists. */}
      <span
        aria-hidden="true"
        className="flex h-16 w-28 items-center justify-center rounded-control bg-white/5 text-stage-ink-soft [&_svg]:size-6 [&_svg]:stroke-[1.75]"
      >
        {icon}
      </span>
      <p className="max-w-sm text-[13px] text-stage-ink-soft">{children}</p>
    </div>
  )
}
