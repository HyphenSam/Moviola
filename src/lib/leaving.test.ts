import { describe, expect, it } from 'vitest'
import { reloadLoss } from './leaving'

describe('reloadLoss', () => {
  it('says nothing when nothing would be lost', () => {
    expect(reloadLoss({ running: false, undownloaded: 0 })).toBeNull()
  })

  it('names the running job', () => {
    expect(reloadLoss({ running: true, undownloaded: 0 })).toBe('Reloading will cancel the running job.')
  })

  it('counts the results that haven’t been downloaded', () => {
    expect(reloadLoss({ running: false, undownloaded: 1 })).toBe(
      'Reloading will discard 1 result you haven’t downloaded.',
    )
    expect(reloadLoss({ running: false, undownloaded: 2 })).toBe(
      'Reloading will discard 2 results you haven’t downloaded.',
    )
  })

  it('names both together', () => {
    expect(reloadLoss({ running: true, undownloaded: 3 })).toBe(
      'Reloading will cancel the running job and discard 3 results you haven’t downloaded.',
    )
  })
})
