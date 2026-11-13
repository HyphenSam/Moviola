import { AudioLines, Film } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { audioSummary, formatSize, hasVideo, videoTrack, type MediaInfo } from '@/lib/info'
import { formatDuration } from '@/lib/timecode'
import type { OpenFrames } from '@/media/frames'
import { Button } from './ui/Button'

/** The open file at the top of the settings column: a thumbnail, the name, a line of facts. */
export function FileCard({
  file,
  info,
  frames,
  onReplace,
}: {
  file: File
  info: MediaInfo
  frames: OpenFrames
  onReplace: () => void
}) {
  const video = videoTrack(info)
  const audio = info.tracks.find((t) => t.kind === 'audio')
  const facts = [
    formatSize(info.size),
    formatDuration(info.duration),
    video ? `${video.width} × ${video.height}` : audio ? audioSummary(audio.sampleRate, audio.channels) : null,
  ].filter(Boolean)
  const [head, tail] = splitName(info.name)

  return (
    <section aria-label="Open file" className="flex items-center gap-3">
      <Thumbnail file={file} info={info} frames={frames} />
      <div className="min-w-0 flex-1">
        {/* Truncates in the middle, so the extension stays visible. */}
        <p className="flex min-w-0 text-[13px] font-medium" title={info.name}>
          <span className="truncate">{head}</span>
          <span className="shrink-0 whitespace-pre">{tail}</span>
        </p>
        {/* Wraps rather than truncates: every fact matters, and the column is narrow. */}
        <p className="text-xs text-ink-soft">
          {facts.map((fact, i) => (
            // The separator sits outside the unbreakable fact, so lines break between facts.
            <Fragment key={i}>
              {i > 0 && ' · '}
              <span className="whitespace-nowrap">{fact}</span>
            </Fragment>
          ))}
        </p>
      </div>
      <Button size="sm" variant="ghost" onClick={onReplace}>
        Replace
      </Button>
    </section>
  )
}

/** The name in two parts: all but the last few characters, and those with the extension. */
function splitName(name: string): [string, string] {
  const dot = name.lastIndexOf('.')
  const keep = Math.max(dot >= 0 ? name.length - dot + 4 : 6, 8)
  return name.length <= keep ? [name, ''] : [name.slice(0, -keep), name.slice(-keep)]
}

function Thumbnail({ file, info, frames }: { file: File; info: MediaInfo; frames: OpenFrames }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [drawn, setDrawn] = useState(false)
  const video = hasVideo(info)

  useEffect(() => {
    if (!video) return
    const source = frames(file, { width: 128, height: 72 })
    let live = true
    // A second in (or a tenth of a short clip), past the black or fade many videos open with.
    source
      .frameAt(Math.min(1, info.duration / 10))
      .then((frame) => {
        const c = canvas.current
        const ctx = c?.getContext('2d')
        if (!live || !frame || !c || !ctx) return
        c.width = frame.image.width
        c.height = frame.image.height
        ctx.drawImage(frame.image, 0, 0)
        setDrawn(true)
      })
      .catch(() => {})
      .finally(() => source.dispose())
    return () => {
      live = false
    }
  }, [file, frames, video, info.duration])

  const Icon = video ? Film : AudioLines
  return (
    <div className="relative flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded-control bg-stage text-stage-ink-soft">
      {!drawn && <Icon aria-hidden="true" className="size-4" strokeWidth={1.75} />}
      {video && <canvas ref={canvas} className={drawn ? 'h-full w-full object-contain' : 'hidden'} />}
    </div>
  )
}
