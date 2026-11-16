import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { JobState } from '@/hooks/useJob'
import type { JobPlan, Planned } from '@/lib/plan'
import { JobProgress } from './JobProgress'
import { LosslessBadge } from './LosslessBadge'
import { Button } from './ui/Button'

// On narrow screens the action (or the progress in its place) is fixed to the foot of the screen
// (DESIGN.md); what explains it stays in the settings, above where the bar sits once scrolled down.
const BAR =
  'max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-20 max-lg:border-t max-lg:border-line max-lg:bg-panel max-lg:px-4 max-lg:pt-3 max-lg:pb-[max(0.75rem,env(safe-area-inset-bottom))]'

/** The foot of the settings column: what stops the job, the primary action with its badge and
 * caption, or the running job's progress in its place. */
export function JobAction({
  planned,
  verb,
  state,
  hint,
  secondary,
  onStart,
  onCancel,
}: {
  /** Null for a tool with no action, which still shows a running job's progress. */
  planned: Planned<JobPlan> | null
  verb: string
  /** Where the job slot stands: the action is there only while it's idle (`useJob`). */
  state: JobState
  hint?: string | null
  /** A second action beside the primary one (Grab frame's Copy). */
  secondary?: ReactNode
  onStart: () => void
  onCancel: () => void
}) {
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const { phase } = state
  const idle = phase === 'idle'
  const busy = phase === 'running' || phase === 'cancelling'
  const was = useRef(phase)
  // The action and Cancel replace each other as a job starts and ends, and the action is disabled
  // while the save dialog is open or a copy is made. Focus on a button that went falls to the page;
  // put it on the one that came instead, so the keyboard doesn't lose its place.
  useEffect(() => {
    if (was.current === phase) return
    was.current = phase
    if (document.activeElement && document.activeElement !== document.body) return
    box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [phase])

  const problems = !busy && planned?.problems
  return (
    <div ref={box} className="flex flex-col gap-2.5">
      {/* There before any problem is, so a problem that a change of settings brings is announced. */}
      <div id={`${id}-problems`} aria-live="polite" className="empty:hidden">
        {problems && (
          <ul className="flex flex-col gap-1 text-[13px] text-danger">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
      </div>
      {phase === 'running' ? (
        <div className={BAR}>
          <JobProgress job={state} onCancel={onCancel} />
        </div>
      ) : phase === 'cancelling' ? (
        // Until the worker (or the save dialog) answers, the job may still be writing.
        <div className={BAR}>
          <p role="status" className="py-1.5 text-[13px] text-ink-soft">
            Cancelling…
          </p>
        </div>
      ) : (
        planned && (
          <>
            <div className={`flex items-center gap-3 ${BAR}`}>
              <Button
                variant="primary"
                disabled={!planned.plan || !idle}
                aria-describedby={problems ? `${id}-problems` : undefined}
                onClick={onStart}
              >
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
          </>
        )
      )}
    </div>
  )
}
