import { Check } from 'lucide-react'
import { Checkbox as RadixCheckbox } from 'radix-ui'
import { useId, type ReactNode } from 'react'

/** A labelled checkbox row, with an optional line under the label that also describes it. `name` is
 * the accessible name when the visible label leans on the section's heading. */
export function Checkbox({
  label,
  name,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  label: ReactNode
  name?: string
  hint?: string | null
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <label
      className={
        disabled
          ? 'flex cursor-not-allowed items-start gap-2.5 rounded-control px-2 py-1.5 text-[13px]'
          : 'flex cursor-pointer items-start gap-2.5 rounded-control px-2 py-1.5 text-[13px] hover:bg-sunken'
      }
    >
      <RadixCheckbox.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={(c) => onChange(c === true)}
        // Named by its label alone; the hint describes it.
        aria-label={name}
        aria-labelledby={name ? undefined : `${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="mt-px flex size-4 shrink-0 items-center justify-center rounded-[4px] ring-1 ring-line-strong data-[state=checked]:bg-accent data-[state=checked]:ring-accent disabled:opacity-45"
      >
        <RadixCheckbox.Indicator>
          <Check className="size-3 text-accent-ink" strokeWidth={3} />
        </RadixCheckbox.Indicator>
      </RadixCheckbox.Root>
      <span className={disabled ? 'min-w-0 text-ink-soft' : 'min-w-0'}>
        <span id={`${id}-label`}>{label}</span>
        {hint && (
          <span id={`${id}-hint`} className="block text-xs text-ink-soft">
            {hint}
          </span>
        )}
      </span>
    </label>
  )
}
