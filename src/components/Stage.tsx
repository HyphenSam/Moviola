import { MonitorX, Upload } from 'lucide-react'
import type { PlayerControls } from '@/hooks/usePlayer'
import type { Source } from '@/hooks/useSource'
import { videoTrack } from '@/lib/info'
import type { TimeRange } from '@/lib/plans/trim'
import type { WorkerClient } from '@/lib/protocol'
import type { OpenFrames } from '@/media/frames'
import { Player } from './Player'
import { Timeline } from './Timeline'
import { Button } from './ui/Button'

/** The dark area where the picture plays: the player and timeline for the open file, the drop target
 * before one is open, or why this browser can't be used. `range` shows the range handles (Trim, Make
 * animation), and `cut` where a fast trim really starts. */
export function Stage({
  source,
  webCodecs,
  frames,
  player,
  thumbnails,
  range,
  cut,
  onRange,
  onMark,
  onBrowse,
}: {
  source: Source | null
  webCodecs: boolean
  frames: OpenFrames
  player: PlayerControls
  thumbnails: WorkerClient['thumbnails']
  range: TimeRange | null
  cut: number | null
  onRange: (range: TimeRange) => void
  onMark: (end: 'in' | 'out', time: number) => void
  onBrowse: () => void
}) {
  const video = source && videoTrack(source.info)
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-stage p-4 text-stage-ink lg:p-5">
      {!webCodecs ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <MonitorX aria-hidden="true" className="size-6 text-stage-ink-soft" strokeWidth={1.75} />
          <h2 className="text-lg leading-snug font-semibold">This browser is too old for Moviola</h2>
          <p className="max-w-sm text-[13px] text-stage-ink-soft">
            It needs WebCodecs to read and write video: Chrome or Edge 94, Firefox 130 or Safari 16.4, or newer.
          </p>
        </div>
      ) : source ? (
        <>
          <Player
            key={source.id}
            file={source.file}
            info={source.info}
            frames={frames}
            player={player}
            onMark={onMark}
          />
          <Timeline
            key={`timeline-${source.id}`}
            file={source.file}
            duration={source.info.duration}
            time={player.time}
            frameRate={video?.frameRate ?? null}
            aspect={video?.height ? video.width / video.height : null}
            thumbnails={thumbnails}
            onSeek={player.seek}
            range={range}
            onRange={onRange}
            cut={cut}
          />
        </>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-panel border-2 border-dashed border-stage-line px-6 py-10 text-center">
          <Upload aria-hidden="true" className="size-6 text-stage-ink-soft" strokeWidth={1.75} />
          <div>
            <h2 className="text-lg leading-snug font-semibold">Drop a video here</h2>
            <p className="mt-1 text-xs text-stage-ink-soft">
              MP4, MOV, MKV, WebM or MPEG-TS video, or an audio file. You can also paste from the clipboard.
            </p>
          </div>
          <Button variant="primary" onClick={onBrowse}>
            Choose file
          </Button>
          <p className="mt-4 text-xs text-stage-ink-soft">Runs on your device. Nothing is uploaded.</p>
        </div>
      )}
    </div>
  )
}
