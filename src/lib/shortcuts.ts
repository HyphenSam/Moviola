/** What a player key does. The timeline's keys (I, O, `,` `.`) come with the timeline. */
export type Shortcut = { type: 'toggle' } | { type: 'nudge'; seconds: number } | { type: 'start' } | { type: 'end' }

/** The parts of a focused element the shortcuts look at. */
export type KeyTarget = { tagName: string; isContentEditable: boolean; getAttribute(name: string): string | null }

type KeyLike = {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  target: KeyTarget | null
}

const TEXT_TAGS = ['TEXTAREA', 'SELECT']
// Controls that Space presses, and controls that use the arrows (and Home, End) themselves.
const SPACE_TAGS = ['BUTTON', 'A', 'SUMMARY']
const ARROW_ROLES = ['radio', 'slider', 'tab', 'menuitem', 'option', 'spinbutton']

/** The player's keyboard shortcuts, unless the focused element needs the key itself. */
export function shortcutFor(e: KeyLike): Shortcut | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const t = e.target
  const tag = t?.tagName ?? ''
  const role = t?.getAttribute('role') ?? ''
  const inputType = tag === 'INPUT' ? (t?.getAttribute('type') ?? 'text') : null
  const isRange = inputType === 'range'
  if (t?.isContentEditable || TEXT_TAGS.includes(tag) || (inputType !== null && !isRange && inputType !== 'checkbox')) {
    return null
  }

  if (e.key === ' ') {
    return SPACE_TAGS.includes(tag) ||
      role === 'radio' ||
      role === 'checkbox' ||
      role === 'switch' ||
      inputType === 'checkbox'
      ? null
      : { type: 'toggle' }
  }
  const usesArrows = isRange || ARROW_ROLES.includes(role)
  if (usesArrows) return null
  switch (e.key) {
    case 'ArrowLeft':
      return { type: 'nudge', seconds: e.shiftKey ? -5 : -1 }
    case 'ArrowRight':
      return { type: 'nudge', seconds: e.shiftKey ? 5 : 1 }
    case 'Home':
      return { type: 'start' }
    case 'End':
      return { type: 'end' }
  }
  return null
}
