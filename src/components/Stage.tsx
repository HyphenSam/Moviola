import { FileVideo, MonitorX, Upload } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './ui/Button'

/** The dark area where the picture plays. Until the player exists it shows the drop target, the open
 * file's name, or why this browser can't be used. */
export function Stage({ file, webCodecs, onBrowse }: { file: File | null; webCodecs: boolean; onBrowse: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 bg-stage p-4 text-stage-ink lg:p-5">
      {!webCodecs ? (
        <Message icon={<MonitorX />} title="This browser is too old for Moviola">
          It needs WebCodecs to read and write video: Chrome or Edge 94, Firefox 130 or Safari 16.4, or newer.
        </Message>
      ) : file ? (
        <Message icon={<FileVideo />} title={file.name} />
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

function Message({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span aria-hidden="true" className="text-stage-ink-soft [&_svg]:size-6 [&_svg]:stroke-[1.75]">
        {icon}
      </span>
      <h2 className="max-w-full truncate text-lg leading-snug font-semibold">{title}</h2>
      {children && <p className="max-w-sm text-[13px] text-stage-ink-soft">{children}</p>}
    </div>
  )
}
