import { AlertCircle, AudioLines, Check, Download, Film, Image, X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { Export } from '@/hooks/useJob'
import { cn } from '@/lib/cn'
import { formatSize } from '@/lib/info'
import { sizeChange, sizeWarnings } from '@/lib/progress'
import { Button } from './ui/Button'

/** The results of this session's jobs, newest first, at the foot of the stage (DESIGN.md). `note` says
 * what became of the last job, for screen readers. */
export function ExportsStrip({
  exports,
  note,
  onRemove,
  onDownload,
}: {
  exports: Export[]
  note: string
  onRemove: (id: number) => void
  onDownload: (id: number) => void
}) {
  const list = useRef<HTMLUListElement>(null)
  // Where a removed card was, so focus can go to the card that takes its place.
  const removed = useRef<number | null>(null)
  useEffect(() => {
    const at = removed.current
    removed.current = null
    if (at === null || (document.activeElement && document.activeElement !== document.body)) return
    const buttons = list.current?.querySelectorAll<HTMLButtonElement>('button[data-remove]')
    buttons?.[Math.min(at, buttons.length - 1)]?.focus()
  }, [exports])

  return (
    <>
      {/* Always there, so the first result is announced as well. */}
      <p role="status" aria-label="Latest export" className="sr-only">
        {note}
      </p>
      {exports.length > 0 && (
        <section aria-label="Exports" className="order-5 border-t border-line bg-panel lg:order-none lg:col-start-3 lg:row-start-3">
          <ul ref={list} className="flex gap-2 overflow-x-auto px-4 py-3 lg:px-5">
            {exports.map((e, i) => (
              <ExportCard
                key={e.id}
                item={e}
                onDownload={() => onDownload(e.id)}
                onRemove={() => {
                  removed.current = i
                  onRemove(e.id)
                }}
              />
            ))}
          </ul>
        </section>
      )}
    </>
  )
}

function ExportCard({ item, onRemove, onDownload }: { item: Export; onRemove: () => void; onDownload: () => void }) {
  const failed = item.error !== undefined
  const image = item.kind === 'frame' || item.kind === 'animation'
  const Icon = failed ? AlertCircle : item.kind === 'audio' ? AudioLines : image ? Image : Film
  // An image's size says nothing against the video's, so only audio and video show the change.
  const change = failed || image ? null : sizeChange(item.size, item.sourceSize)
  const warnings = !failed && item.sizeCheck ? sizeWarnings(item.size, item.sourceSize, item.sizeCheck.target) : null
  return (
    <li
      className={cn(
        'flex w-72 shrink-0 items-center gap-3 rounded-panel px-3 py-2.5 ring-1',
        failed ? 'ring-danger' : 'ring-line',
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn('size-5 shrink-0', failed ? 'text-danger' : 'text-ink-soft')}
        strokeWidth={1.75}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium" title={item.name}>
          {item.name}
        </p>
        {failed ? (
          <p className="text-xs text-danger">{item.error}</p>
        ) : (
          <p className="text-xs text-ink-soft">{[formatSize(item.size), change].filter(Boolean).join(' · ')}</p>
        )}
        {warnings?.overTarget && <p className="text-xs text-danger">{warnings.overTarget}</p>}
        {warnings?.larger && <p className="text-xs text-ink">{warnings.larger}</p>}
      </div>
      {!failed &&
        (item.url ? (
          <a
            href={item.url}
            download={item.name}
            onClick={onDownload}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control bg-panel px-2.5 text-[13px] font-medium text-ink shadow-[0_0_0_1px_var(--color-line-strong)] transition-colors duration-150 hover:bg-sunken [&_svg]:size-4"
          >
            <Download aria-hidden="true" />
            Download
          </a>
        ) : (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-ok">
            <Check aria-hidden="true" className="size-4" />
            Saved
          </span>
        ))}
      <Button
        size="sm"
        variant="ghost"
        data-remove
        aria-label={`Remove ${item.name}`}
        className="px-1.5"
        onClick={onRemove}
      >
        <X />
      </Button>
    </li>
  )
}
