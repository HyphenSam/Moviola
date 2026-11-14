import { describe, expect, it } from 'vitest'
import { percent, remaining, sizeChange, sizeWarnings } from './progress'

describe('percent', () => {
  it('rounds down, so 100% means finished', () => {
    expect(percent(0)).toBe('0%')
    expect(percent(0.4567)).toBe('45%')
    expect(percent(0.999)).toBe('99%')
    expect(percent(1)).toBe('100%')
  })
})

describe('remaining', () => {
  it('says nothing until past 3%, when the estimate settles', () => {
    expect(remaining(null, 10)).toBeNull()
    expect(remaining(0.03, 10)).toBeNull()
  })

  it('estimates from the time so far', () => {
    expect(remaining(0.5, 60)).toBe('About 1 minute left')
    expect(remaining(0.25, 60)).toBe('About 3 minutes left')
    expect(remaining(0.5, 40)).toBe('About 40 seconds left')
    expect(remaining(0.1, 1000)).toBe('About 2 hours 30 minutes left')
  })

  it('rounds seconds to fives and keeps the last few vague', () => {
    expect(remaining(0.5, 23)).toBe('About 25 seconds left')
    expect(remaining(0.9, 20)).toBe('A few seconds left')
  })
})

describe('sizeChange', () => {
  it('shows the change against the source, with a true minus sign', () => {
    expect(sizeChange(17, 100)).toBe('−83%')
    expect(sizeChange(104, 100)).toBe('+4%')
    expect(sizeChange(100, 100)).toBe('±0%')
  })

  it('keeps a tiny result from rounding to nothing', () => {
    expect(sizeChange(1, 100_000)).toBe('−99%')
  })

  it('has nothing to compare an empty source with', () => {
    expect(sizeChange(10, 0)).toBeNull()
  })
})

describe('sizeWarnings', () => {
  it('flags a result more than 5% over the target', () => {
    expect(sizeWarnings(10_600_000, 50_000_000, 10_000_000)).toEqual({
      overTarget: '6% over the 10 MB target.',
      larger: null,
    })
  })

  it('rounds the miss up, so a flagged result never reads as 5%', () => {
    expect(sizeWarnings(10_533_907, 50_000_000, 10_000_000).overTarget).toBe('6% over the 10 MB target.')
  })

  it('lets a result within 5% of the target pass', () => {
    expect(sizeWarnings(10_500_000, 50_000_000, 10_000_000)).toEqual({ overTarget: null, larger: null })
    expect(sizeWarnings(9_000_000, 50_000_000, 10_000_000)).toEqual({ overTarget: null, larger: null })
  })

  it('says plainly when the result is larger than the original, and what to try', () => {
    expect(sizeWarnings(10_400_000, 10_000_000, null)).toEqual({
      overTarget: null,
      larger: '4% larger than the original. Try a lower quality.',
    })
    expect(sizeWarnings(31_000_000, 30_000_000, 50_000_000)).toEqual({
      overTarget: null,
      larger: '3% larger than the original. Try a smaller target.',
    })
  })

  it('never says 0% larger', () => {
    expect(sizeWarnings(10_000_001, 10_000_000, null).larger).toBe('1% larger than the original. Try a lower quality.')
  })
})
