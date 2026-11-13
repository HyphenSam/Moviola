import { describe, expect, it } from 'vitest'
import { formatDuration, formatTimecode } from './timecode'

describe('formatDuration', () => {
  it('gives a length to the nearest second, with hours when there are any', () => {
    expect(formatDuration(4)).toBe('0:04')
    expect(formatDuration(83.5)).toBe('1:24')
    expect(formatDuration(3600 + 62.4)).toBe('1:01:02')
    expect(formatDuration(0.3)).toBe('0:00')
  })
})

describe('formatTimecode', () => {
  it('writes m:ss.mmm under an hour and h:mm:ss.mmm from an hour', () => {
    expect(formatTimecode(0)).toBe('0:00.000')
    expect(formatTimecode(4)).toBe('0:04.000')
    expect(formatTimecode(83.5)).toBe('1:23.500')
    expect(formatTimecode(3600 + 62.25)).toBe('1:01:02.250')
  })

  it('rounds to the millisecond without carrying into a 60th second', () => {
    expect(formatTimecode(59.9996)).toBe('1:00.000')
    expect(formatTimecode(1.0004)).toBe('0:01.000')
  })

  it('treats negative and unknown times as zero', () => {
    expect(formatTimecode(-1)).toBe('0:00.000')
    expect(formatTimecode(Number.NaN)).toBe('0:00.000')
  })

  it('can leave the hours in when the whole file runs over an hour, so digits don’t jump', () => {
    expect(formatTimecode(5, { hours: true })).toBe('0:00:05.000')
  })
})
