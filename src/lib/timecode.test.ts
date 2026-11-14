import { describe, expect, it } from 'vitest'
import { formatDuration, formatTimecode, frameDuration, parseTimecode, stepFrames } from './timecode'

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

describe('parseTimecode', () => {
  it('reads plain seconds, whole or fractional', () => {
    expect(parseTimecode('90')).toBe(90)
    expect(parseTimecode('90.5')).toBe(90.5)
    expect(parseTimecode('0')).toBe(0)
    expect(parseTimecode('.5')).toBe(0.5)
  })

  it('reads minutes and seconds', () => {
    expect(parseTimecode('1:30')).toBe(90)
    expect(parseTimecode('1:30.5')).toBe(90.5)
    expect(parseTimecode('0:05')).toBe(5)
    expect(parseTimecode('12:3')).toBe(723)
  })

  it('reads hours, minutes and seconds', () => {
    expect(parseTimecode('0:01:30.500')).toBe(90.5)
    expect(parseTimecode('1:02:03.004')).toBe(3723.004)
    expect(parseTimecode('10:00:00')).toBe(36000)
  })

  it('ignores spaces around the time', () => {
    expect(parseTimecode(' 1:30 ')).toBe(90)
  })

  it('rounds to the millisecond, as the field shows', () => {
    expect(parseTimecode('1.23456')).toBe(1.235)
  })

  it('takes a trailing point as no fraction', () => {
    expect(parseTimecode('1:30.')).toBe(90)
  })

  it('refuses anything that isn’t a time', () => {
    for (const text of ['', ' ', 'abc', '1:', ':30', '1::30', '1:2:3:4', '-5', '1:-5', '1.5:30', '1:30.5.5', '1e3']) {
      expect(parseTimecode(text), text).toBeNull()
    }
  })

  it('refuses 60 or more seconds after minutes, and 60 or more minutes after hours', () => {
    expect(parseTimecode('1:60')).toBeNull()
    expect(parseTimecode('1:59.999')).toBe(119.999)
    expect(parseTimecode('1:60:00')).toBeNull()
    // Without hours, minutes can run on: 75:00 is an hour and a quarter.
    expect(parseTimecode('75:00')).toBe(4500)
  })

  it('reads back what formatTimecode writes', () => {
    for (const t of [0, 0.04, 12.48, 83.5, 3723.004]) {
      expect(parseTimecode(formatTimecode(t))).toBe(t)
      expect(parseTimecode(formatTimecode(t, { hours: true }))).toBe(t)
    }
  })
})

describe('frame stepping', () => {
  it('gives a frame’s length, assuming 30 fps when the rate is unknown', () => {
    expect(frameDuration(25)).toBe(0.04)
    expect(frameDuration(null)).toBeCloseTo(1 / 30)
  })

  it('steps from frame to frame on the frame grid', () => {
    expect(stepFrames(0, 1, 25)).toBeCloseTo(0.04)
    expect(stepFrames(0.04, 1, 25)).toBeCloseTo(0.08)
    expect(stepFrames(0.08, -2, 25)).toBeCloseTo(0)
    expect(stepFrames(1, 25, 25)).toBeCloseTo(2)
  })

  it('steps from the frame showing, when the time falls inside a frame', () => {
    // 0.07 s at 25 fps shows frame 1 (0.04 to 0.08): the next is frame 2, the previous frame 0.
    expect(stepFrames(0.07, 1, 25)).toBeCloseTo(0.08)
    expect(stepFrames(0.07, -1, 25)).toBeCloseTo(0)
  })

  it('isn’t thrown by a time that lands a hair under a frame boundary', () => {
    // 3 / 25 computes as 0.12000000000000001 and 0.12 × 25 as 3.0000000000000004; both are frame 3.
    expect(stepFrames(0.12, 1, 25)).toBeCloseTo(0.16)
    expect(stepFrames(7 * (1001 / 30000), 1, 30000 / 1001)).toBeCloseTo(8 * (1001 / 30000))
  })

  it('steps on from a frame time the browser reports cut to the microsecond', () => {
    // Chrome reads a seek to 1 / 30 back as 0.033333: still frame 1, so the next is frame 2.
    for (const rate of [24, 30, 30000 / 1001, 60]) {
      for (let k = 1; k <= 10; k++) {
        const reported = Math.floor((k / rate) * 1e6) / 1e6
        expect(stepFrames(reported, 1, rate)).toBeCloseTo((k + 1) / rate)
        expect(stepFrames(reported, -1, rate)).toBeCloseTo((k - 1) / rate)
      }
    }
  })

  it('never steps before 0', () => {
    expect(stepFrames(0, -1, 25)).toBe(0)
  })

  it('steps at 30 fps when the rate is unknown', () => {
    expect(stepFrames(0, 3, null)).toBeCloseTo(0.1)
  })
})
