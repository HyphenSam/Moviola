import { AlertCircle, AudioLines, Check, Download, Film, Image, X } from 'lucide-react'
import type { Export } from '@/hooks/useJob'
import { cn } from '@/lib/cn'
import { formatSize } from '@/lib/info'
import { sizeChange, sizeWarnings } from '@/lib/progress'
import { Button } from './ui/Button'

/** The results of this session's jobs, newest first, at the foot of the stage (DESIGN.md). */
export function ExportsStrip({ exports, onRemove }: { exports: Export[]; onRemove: (id: number) => void }) {
  if (!exports.length) return null
  return (
    <section aria-label="Exports" className="border-t border-line bg-panel">
      <ul className="flex gap-2 overflow-x-auto px-4 py-3 lg:px-5">
        {exports.map((e) => (
          <ExportCard key={e.id} item={e} onRemove={() => onRemove(e.id)} />
        ))}
      </ul>
    </section>
  )
}

function ExportCard({ item, onRemove }: { item: Export; onRemove: () => void }) {
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
      <Button size="sm" variant="ghost" aria-label={`Remove ${item.name}`} className="px-1.5" onClick={onRemove}>
        <X />
      </Button>
    </li>
  )
}
