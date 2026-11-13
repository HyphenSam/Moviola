import { Check, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The Honest Label beside every action (DESIGN.md): the icon and the words carry the meaning, the
 * colour only backs them up. */
export function LosslessBadge({ lossless }: { lossless: boolean }) {
  const Icon = lossless ? Check : RefreshCw
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium ring-1',
        lossless ? 'text-ok ring-ok' : 'text-ink-soft ring-line-strong',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
      {lossless ? 'Lossless' : 'Re-encodes'}
    </span>
  )
}
