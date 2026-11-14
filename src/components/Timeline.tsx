import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { TimeRange } from '@/lib/plans/trim'
import type { WorkerClient } from '@/lib/protocol'
import { formatTimecode, stepFrames } from '@/lib/timecode'
import { gripLefts, moveEnd, thumbnailCount, thumbnailTimes, timeAt } from '@/lib/timeline'

const HEIGHT = 48
/** The range grips' width: w-3. */
const GRIP = 12

type Dragging = 'playhead' | 'start' | 'end'

/** The strip under the player (DESIGN.md): thumbnails of the whole file, a playhead to click or drag,
 * and, for the tools that use a range, amber in and out handles with the strip dimmed outside them and
 * a dashed marker where a fast trim really starts (`cut`). The playhead and handles are sliders. */
export function Timeline({
  file,
  duration,
  time,
  frameRate,
  aspect,
  thumbnails,
  onSeek,
  range,
  onRange,
  cut,
}: {
  file: File
  duration: number
  time: number
  frameRate: number | null
  /** The video's shape, width over height; null for audio, which has no thumbnails. */
  aspect: number | null
  thumbnails: WorkerClient['thumbnails']
  onSeek: (time: number) => void
  range: TimeRange | null
  onRange: (range: TimeRange) => void
  cut: number | null
}) {
  const strip = useRef<HTMLDivElement>(null)
  const dragging = useRef<Dragging | null>(null)
  const [width, setWidth] = useState(0)
  const hours = duration >= 3600
  const at = (clientX: number) => {
    const box = strip.current!.getBoundingClientRect()
    return timeAt(clientX - box.left, box.width, duration)
  }
  const percent = (t: number) => `${duration > 0 ? (Math.min(Math.max(t, 0), duration) / duration) * 100 : 0}%`

  // Measured before paint, so the grips never show at a width of 0.
  useLayoutEffect(() => {
    const el = strip.current!
    setWidth(el.clientWidth)
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const grips = range && gripLefts(range, duration, width, GRIP)

  function move(what: Dragging, t: number) {
    if (what === 'playhead' || !range) return onSeek(t)
    const next = moveEnd(range, what, t, frameRate, duration)
    onRange(next)
    // Show the frame the cut lands on.
    onSeek(next[what])
  }

  function grab(what: Dragging, e: PointerEvent<HTMLElement>) {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    dragging.current = what
    e.currentTarget.setPointerCapture?.(e.pointerId)
    // A handle stays put until it's dragged: the grip is wide, and grabbing it off centre shouldn't
    // nudge the cut.
    if (what === 'playhead') move(what, at(e.clientX))
  }

  // Arrow keys: a second for the playhead (five with Shift), as the player's own keys; a frame for a
  // handle (a second with Shift), for placing a cut exactly.
  function onKey(what: Dragging, value: number, e: KeyboardEvent) {
    const sign =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0
    let t: number | null = null
    if (sign && what === 'playhead') t = value + sign * (e.shiftKey ? 5 : 1)
    else if (sign) t = e.shiftKey ? value + sign : stepFrames(value, sign, frameRate)
    else if (e.key === 'Home') t = 0
    else if (e.key === 'End') t = duration
    if (t === null) return
    e.preventDefault()
    move(what, Math.min(Math.max(t, 0), duration))
  }

  const slider = (what: Dragging, label: string, value: number) => ({
    role: 'slider',
    tabIndex: 0,
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': duration,
    'aria-valuenow': value,
    'aria-valuetext': formatTimecode(value, { hours }),
    onKeyDown: (e: KeyboardEvent) => onKey(what, value, e),
  })

  return (
    <div className="shrink-0 px-1 pt-1 pb-0.5">
      <div
        ref={strip}
        role="group"
        aria-label="Timeline"
        className="relative h-12 touch-none overflow-hidden rounded-control bg-white/8 select-none"
        onPointerDown={(e) => grab('playhead', e)}
        onPointerMove={(e) => dragging.current && move(dragging.current, at(e.clientX))}
        onPointerUp={() => (dragging.current = null)}
        onPointerCancel={() => (dragging.current = null)}
      >
        <Thumbnails file={file} duration={duration} aspect={aspect} thumbnails={thumbnails} width={width} />
        {range && (
          <>
            <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: percent(range.start) }} />
            <div className="absolute inset-y-0 right-0 bg-black/65" style={{ left: percent(range.end) }} />
            <div
              className="absolute inset-y-0 border-y-2 border-accent"
              style={{ left: percent(range.start), right: `calc(100% - ${percent(range.end)})` }}
            />
          </>
        )}
        {cut !== null && (
          <div
            role="img"
            aria-label={`Fast trim starts at ${formatTimecode(cut, { hours })}`}
            className="absolute inset-y-0 -ml-px border-l-2 border-dashed border-stage-ink/90"
            style={{ left: percent(cut) }}
          />
        )}
        <div
          {...slider('playhead', 'Playhead', time)}
          className="absolute inset-y-0 -ml-px w-0.5 bg-stage-ink focus-visible:outline-offset-2"
          style={{ left: percent(time) }}
        >
          <span
            aria-hidden="true"
            className="absolute -top-0.5 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-stage-ink"
          />
        </div>
        {range && grips && (
          <>
            <Handle
              {...slider('start', 'In point', range.start)}
              side="start"
              left={grips.start}
              onPointerDown={(e) => grab('start', e)}
            />
            <Handle
              {...slider('end', 'Out point', range.end)}
              side="end"
              left={grips.end}
              onPointerDown={(e) => grab('end', e)}
            />
          </>
        )}
      </div>
    </div>
  )
}

/** An amber grip at one end of the range, its flat side facing in, `left` pixels along the strip. Wide
 * enough to grab with a finger. */
function Handle({
  side,
  left,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { side: 'start' | 'end'; left: number }) {
  return (
    <div
      {...props}
      className={`absolute inset-y-0 flex w-3 cursor-ew-resize items-center justify-center bg-accent focus-visible:outline-offset-1 ${side === 'start' ? 'rounded-l-[4px]' : 'rounded-r-[4px]'}`}
      style={{ left }}
    >
      <span aria-hidden="true" className="h-4 w-0.5 rounded-full bg-accent-ink/60" />
    </div>
  )
}

/** The thumbnails, drawn side by side on one canvas: as many as fit the strip at the video's shape,
 * asked for once the strip's width settles, and kept for the file (the Timeline is keyed per file). */
function Thumbnails({
  file,
  duration,
  aspect,
  thumbnails,
  width,
}: {
  file: File
  duration: number
  aspect: number | null
  thumbnails: WorkerClient['thumbnails']
  /** The strip's width in CSS pixels. */
  width: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<(ImageBitmap | null)[]>([])
  const cache = useRef(new Map<number, (ImageBitmap | null)[]>())
  const count = aspect ? thumbnailCount(width, aspect, HEIGHT) : 0

  useEffect(() => {
    if (!count) return
    const cached = cache.current.get(count)
    if (cached) return setImages(cached)
    let live = true
    // Wait for a resize to settle before decoding a new set.
    const timer = setTimeout(() => {
      const height = Math.round(HEIGHT * (window.devicePixelRatio || 1))
      thumbnails(file, thumbnailTimes(duration, count), height).then(
        (got) => {
          cache.current.set(count, got)
          if (live) setImages(got)
        },
        () => {},
      )
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [file, duration, count, thumbnails])

  useEffect(() => {
    const c = canvas.current
    if (!c || !width) return
    const scale = window.devicePixelRatio || 1
    c.width = Math.round(width * scale)
    c.height = Math.round(HEIGHT * scale)
    const ctx = c.getContext('2d')
    if (!ctx || !images.length) return
    const slot = c.width / images.length
    images.forEach((image, i) => {
      if (!image) return
      // Centred in its slot at full height; the slot clips what doesn't fit.
      const w = (image.width * c.height) / image.height
      ctx.save()
      ctx.beginPath()
      ctx.rect(i * slot, 0, slot, c.height)
      ctx.clip()
      ctx.drawImage(image, i * slot + (slot - w) / 2, 0, w, c.height)
      ctx.restore()
    })
  }, [images, width])

  return <canvas ref={canvas} aria-hidden="true" className="absolute inset-0 size-full" />
}
