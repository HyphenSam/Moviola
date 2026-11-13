import { MonitorX, Upload } from 'lucide-react'
import type { Source } from '@/hooks/useSource'
import type { OpenFrames } from '@/media/frames'
import { Player } from './Player'
import { Button } from './ui/Button'

/** The dark area where the picture plays: the player for the open file, the drop target before one
 * is open, or why this browser can't be used. */
export function Stage({
  source,
  webCodecs,
  frames,
  onBrowse,
}: {
  source: Source | null
  webCodecs: boolean
  frames: OpenFrames
  onBrowse: () => void
}) {
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
        <Player key={source.id} file={source.file} info={source.info} frames={frames} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-panel border-2 border-dashed border-stage-line px-6 py-10 text-center">
          <Upload aria-hidden="true" className="size-6 text-stage-ink-soft" strokeWidth={1.75} />
          <div>
            <h2 className="text-lg leading-snug font-semibold">Drop a video here</h2>
            <p className="mt-1 text-xs text-stage-ink-soft">
              MP4, MOV, MKV, WebM or MPEG-TS video, or an audio file. Nothing is uploaded.
            </p>
          </div>
          <Button variant="primary" onClick={onBrowse}>
            Choose file
          </Button>
        </div>
      )}
    </div>
  )
}
