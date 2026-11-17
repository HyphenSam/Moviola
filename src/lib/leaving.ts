/** What leaving the page would lose (SPEC.md section 7). */
export type AtStake = { running: boolean; undownloaded: number }

/** What a reload would lose, in a sentence for the update banner, or null when it would lose nothing. */
export function reloadLoss({ running, undownloaded }: AtStake): string | null {
  const results = `discard ${undownloaded} result${undownloaded === 1 ? '' : 's'} you haven’t downloaded`
  if (running && undownloaded) return `Reloading will cancel the running job and ${results}.`
  if (running) return 'Reloading will cancel the running job.'
  if (undownloaded) return `Reloading will ${results}.`
  return null
}
