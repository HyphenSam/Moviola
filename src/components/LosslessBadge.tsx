import { Check, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/cn'

/** The Honest Label beside every action (DESIGN.md): the icon and the words carry the meaning, the
 * colour only backs them up. `label` replaces "Re-encodes" where that would mislead ("Decodes to
 * WAV"); it keeps the Re-encodes style. */
export function LosslessBadge({ lossless, label }: { lossless: boolean; label?: string }) {
  const Icon = lossless ? Check : RefreshCw
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-medium ring-1',
        lossless ? 'text-ok ring-ok' : 'text-ink-soft ring-line-strong',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" strokeWidth={2} />
      {lossless ? 'Lossless' : (label ?? 'Re-encodes')}
    </span>
  )
}
