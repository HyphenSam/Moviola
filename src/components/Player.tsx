import { AudioLines, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { PlayerControls } from '@/hooks/usePlayer'
import { videoTrack, type MediaInfo } from '@/lib/info'
import { shortcutFor } from '@/lib/shortcuts'
import { formatDuration } from '@/lib/timecode'
import type { Frame, FrameSource, OpenFrames } from '@/media/frames'
import { Transport } from './Transport'

// The fallback preview's frames fit this box; plenty for judging the picture, quick to decode.
const PREVIEW_BOX = { width: 1280, height: 720 }

/** Shows the open file (SPEC.md section 5). Native playback first, since it brings sound and smooth
 * seeking; if the browser can't play the file, decoded frames without sound; if it can't decode the
 * video either, a sentence saying so. Render it with a `key` per file so each file starts afresh.
 * The player state comes from above (`usePlayer`), where the tools share the playhead; `onMark` sets
 * the range's in or out point at the playhead (I and O). */
export function Player({
  file,
  info,
  frames,
  player,
  onMark,
}: {
  file: File
  info: MediaInfo
  frames: OpenFrames
  player: PlayerControls
  onMark: (end: 'in' | 'out', time: number) => void
}) {
  const video = videoTrack(info)
  const [mode, setMode] = useState<'native' | 'frames' | 'none'>('native')
  const { report } = player
  // Firefox seeks H.264 with B-frames in Matroska up to 4 frames short, and nothing on the element
  // says so (CLAUDE.md). Covering the paused picture with the frame decoded at the playhead shows what
  // Trim and Grab frame use; other browsers land on that frame anyway.
  const cover = mode === 'native' && !!video?.reordered && (info.container === 'mkv' || info.container === 'webm')

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { key, shiftKey, ctrlKey, metaKey, altKey } = e
      const target = e.target instanceof HTMLElement ? e.target : null
      const shortcut = shortcutFor({ key, shiftKey, ctrlKey, metaKey, altKey, target })
      if (!shortcut) return
      e.preventDefault()
      // Without a picture there's nothing to play, but the playhead still moves along the timeline
      // and marks the range for the copying tools.
      if (shortcut.type === 'toggle') player.toggle()
      else if (shortcut.type === 'nudge') player.nudge(shortcut.seconds)
      else if (shortcut.type === 'step') player.step(shortcut.frames)
      else if (shortcut.type === 'mark') onMark(shortcut.end, player.now.current.time)
      else player.seek(shortcut.type === 'start' ? 0 : info.duration)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [player, info.duration, onMark])

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
                <NativeMedia kind="audio" file={file} player={player} frameRate={null} onUnsupported={unsupported} />
              ) : null}
            </AudioPanel>
          ) : mode === 'native' ? (
            <NativeMedia
              kind="video"
              file={file}
              player={player}
              frameRate={video.frameRate}
              onUnsupported={unsupported}
            />
          ) : mode === 'frames' ? (
            <FrameView file={file} frames={frames} player={player} />
          ) : (
            <Unavailable icon={<VideoOff />}>
              This browser can’t show this video, but copying tools still work.
            </Unavailable>
          )}
        </div>
        {cover && <PausedFrame file={file} frames={frames} player={player} />}
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

// How far past the clock's 0 the element's picture may start before it's taken to be misplaced: AAC
// priming puts the sound up to about 50 ms ahead of the picture, and Firefox's 0.56 s is well beyond.
const LATE_PICTURE = 0.1

/** The element's time `t` on the playhead's clock, within the file. */
const playhead = (t: number, offset: number, duration: number) => Math.min(Math.max(0, t - offset), duration)

/** A `<video>` or `<audio>` on an object URL of the file: the browser reads it lazily, never whole.
 *
 * The element's clock isn't always the playhead's. For a file whose first timestamp is 10 s in,
 * Chrome counts from the timestamps (the first frame is at 10 s) and Firefox from the first one, as
 * the playhead does. Where the clock stands once the first frame is in is the playhead's 0, so times
 * are translated by that both ways; until then, a seek waits. The length is the probed one: the
 * element's can be wrong (Chrome's MP4 one is provisional, Firefox counts MKV and WebM from 0). */
function NativeMedia({
  kind,
  file,
  player,
  frameRate,
  onUnsupported,
}: {
  kind: 'video' | 'audio'
  file: File
  player: PlayerControls
  frameRate: number | null
  onUnsupported: () => void
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)
  const [url, setUrl] = useState<string>()
  const { report, backend, playing, muted, volume, duration, now } = player
  const failed = useRef(onUnsupported)
  failed.current = onUnsupported
  // The element's time at the playhead's 0, once its first frame is in.
  const offset = useRef<number | null>(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  useEffect(() => {
    const el = ref.current!
    backend.current = {
      play: () => {
        // Where the element plays on past the end (see `time`), start over as at a real end.
        if (offset.current !== null && el.currentTime - offset.current >= duration) el.currentTime = offset.current
        void el.play().catch(() => {})
      },
      pause: () => el.pause(),
      seek: (t) => {
        if (offset.current !== null) el.currentTime = t + offset.current
      },
    }
    const time = () => {
      if (offset.current === null) return
      report.time(playhead(el.currentTime, offset.current, duration))
      if (el.currentTime - offset.current >= duration && !el.paused) el.pause()
    }
    const on = { play: () => report.playing(true), pause: () => report.playing(false) }
    // Some browsers play a file's sound but can't decode its picture; that's no preview either.
    const metadata = () => kind === 'video' && el.videoWidth === 0 && failed.current()
    let warned = false
    const length = () => {
      const says = el.duration - (offset.current ?? 0)
      if (warned || offset.current === null || !Number.isFinite(says)) return
      if (Math.abs(says - duration) <= 1 / (frameRate ?? 30)) return
      warned = true
      console.warn(
        `The browser says ${file.name} is ${says.toFixed(3)} s long; it is ${duration.toFixed(3)} s, so the player stops there.`,
      )
    }
    const loaded = () => {
      if (offset.current !== null) return
      offset.current = el.currentTime
      const buffered = el.buffered.length ? el.buffered.start(0) - offset.current : 0
      if (kind === 'video' && buffered > LATE_PICTURE) return failed.current()
      length()
      // A seek asked for while loading, or the playhead where an earlier element left it.
      if (now.current.time > 0) el.currentTime = now.current.time + offset.current
    }
    const error = () => failed.current()
    el.addEventListener('play', on.play)
    el.addEventListener('pause', on.pause)
    el.addEventListener('ended', on.pause)
    el.addEventListener('timeupdate', time)
    el.addEventListener('seeked', time)
    el.addEventListener('loadedmetadata', metadata)
    el.addEventListener('loadeddata', loaded)
    el.addEventListener('durationchange', length)
    el.addEventListener('error', error)
    return () => {
      backend.current = null
      el.removeEventListener('play', on.play)
      el.removeEventListener('pause', on.pause)
      el.removeEventListener('ended', on.pause)
      el.removeEventListener('timeupdate', time)
      el.removeEventListener('seeked', time)
      el.removeEventListener('loadedmetadata', metadata)
      el.removeEventListener('loadeddata', loaded)
      el.removeEventListener('durationchange', length)
      el.removeEventListener('error', error)
    }
  }, [backend, report, kind, now, duration, frameRate, file.name])

  useEffect(() => {
    ref.current!.muted = muted
    ref.current!.volume = volume
  }, [muted, volume])

  // timeupdate comes a few times a second; follow the playhead every frame while playing.
  useEffect(() => {
    if (!playing) return
    let frame = requestAnimationFrame(function tick() {
      if (ref.current && offset.current !== null)
        report.time(playhead(ref.current.currentTime, offset.current, duration))
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [playing, report, duration])

  if (kind === 'audio') return <audio ref={ref} src={url} preload="auto" />
  // No controls of its own: the transport drives it. Firefox would still make it an unnamed tab stop.
  return <video ref={ref} src={url} preload="auto" playsInline tabIndex={-1} className="h-full w-full object-contain" />
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

    const draw = (image: Frame['image']) => canvas.current && drawOn(canvas.current, image)

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

/** The frame decoded at the playhead, over the video while it's paused; hidden while it plays. */
function PausedFrame({ file, frames, player }: { file: File; frames: OpenFrames; player: PlayerControls }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const source = useRef<FrameSource | null>(null)
  const { time, playing } = player

  useEffect(() => {
    const s = frames(file, PREVIEW_BOX)
    source.current = s
    return () => {
      source.current = null
      s.dispose()
    }
  }, [file, frames])

  useEffect(() => {
    if (playing) return
    // A later seek's frame wins over a slower earlier one; reads cut short by disposing fail quietly.
    let current = true
    source.current
      ?.frameAt(time)
      .then((frame) => frame && current && canvas.current && drawOn(canvas.current, frame.image))
      .catch(() => {})
    return () => {
      current = false
    }
  }, [time, playing, file, frames])

  return <canvas ref={canvas} hidden={playing} className="absolute inset-0 h-full w-full object-contain" />
}

function drawOn(c: HTMLCanvasElement, image: Frame['image']) {
  if (c.width !== image.width || c.height !== image.height) {
    c.width = image.width
    c.height = image.height
  }
  c.getContext('2d')?.drawImage(image, 0, 0)
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
