import { useEffect, useState } from 'react'
import type { Running } from '@/hooks/useJob'
import { percent, remaining } from '@/lib/progress'
import { Button } from './ui/Button'

/** Replaces the primary action while a job runs: an amber bar filling left to right (pulsing while
 * the job can't say how far it is), the percentage and time left, and Cancel. */
export function JobProgress({ job, onCancel }: { job: Running; onCancel: () => void }) {
  // Ticks once a second so the time left keeps moving even between progress reports.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const { fraction } = job
  const left = remaining(fraction, (Math.max(now, job.startedAt) - job.startedAt) / 1000)
  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div
          role="progressbar"
          aria-label={`${job.doing} ${job.name}`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={fraction === null ? undefined : Math.floor(fraction * 100)}
          className="h-1.5 overflow-hidden rounded-full bg-sunken"
        >
          <div
            className={
              fraction === null ? 'h-full w-full animate-pulse bg-accent' : 'h-full bg-accent transition-[width]'
            }
            style={fraction === null ? undefined : { width: `${fraction * 100}%` }}
          />
        </div>
        <p className="mt-1.5 flex gap-2 text-xs text-ink-soft">
          <span>{fraction === null ? 'Starting…' : percent(fraction)}</span>
          {left && <span>{left}</span>}
        </p>
        {job.inMemory && (
          <p className="mt-1 text-xs text-ink-soft">
            The save dialog can’t be used here, so the result is held in memory until you download it.
          </p>
        )}
      </div>
      <Button onClick={onCancel}>Cancel</Button>
    </div>
  )
}
