import type { Running } from '@/hooks/useJob'
import type { ReactNode } from 'react'
import type { JobPlan, Planned } from '@/lib/plan'
import { JobProgress } from './JobProgress'
import { LosslessBadge } from './LosslessBadge'
import { Button } from './ui/Button'

/** The foot of the settings column: what stops the job, the primary action with its badge and
 * caption, or the running job's progress in its place. */
export function JobAction({
  planned,
  verb,
  running,
  hint,
  secondary,
  onStart,
  onCancel,
}: {
  /** Null for a tool with no action, which still shows a running job's progress. */
  planned: Planned<JobPlan> | null
  verb: string
  running: Running | null
  hint?: string | null
  /** A second action beside the primary one (Grab frame's Copy). */
  secondary?: ReactNode
  onStart: () => void
  onCancel: () => void
}) {
  if (running) return <JobProgress job={running} onCancel={onCancel} />
  if (!planned) return null
  return (
    <div className="flex flex-col gap-2.5">
      {planned.problems && (
        <ul className="flex flex-col gap-1 text-[13px] text-danger">
          {planned.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={!planned.plan} onClick={onStart}>
          {verb}
        </Button>
        {secondary}
        {/* A frame isn't a copy of the stream, nor re-encoded as one: it has no badge (SPEC.md 6.7). */}
        {planned.plan && planned.plan.kind !== 'frame' && (
          <LosslessBadge lossless={planned.plan.lossless} label={planned.badge} />
        )}
      </div>
      {planned.caption && <p className="text-xs text-ink-soft">{planned.caption}</p>}
      {planned.hints?.map((h) => (
        <p key={h} className="text-xs text-ink-soft">
          {h}
        </p>
      ))}
      {hint && <p className="text-xs text-ink-soft">{hint}</p>}
    </div>
  )
}
