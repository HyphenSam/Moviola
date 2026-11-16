import { describe, expect, it } from 'vitest'
import { extensionOf, outputName, stem, uniqueName, usableExtension } from './names'

describe('stem', () => {
  it('drops the last extension only', () => {
    expect(stem('holiday.mp4')).toBe('holiday')
    expect(stem('take.2.final.mov')).toBe('take.2.final')
  })

  it('keeps a name with no extension, or one that only starts with a dot', () => {
    expect(stem('clip')).toBe('clip')
    expect(stem('.hidden')).toBe('.hidden')
  })
})

describe('extensionOf', () => {
  it('is the last extension, or null when there is none', () => {
    expect(extensionOf('clip.M4V')).toBe('M4V')
    expect(extensionOf('take.2.final.mov')).toBe('mov')
    expect(extensionOf('clip')).toBeNull()
    expect(extensionOf('.hidden')).toBeNull()
  })
})

describe('extensionOf', () => {
  it('is empty for a name that ends in a dot', () => {
    expect(extensionOf('clip.')).toBe('')
  })
})

describe('usableExtension', () => {
  it('takes letters, digits and + as written', () => {
    for (const extension of ['mp4', 'M4V', 'm2ts', '3gp', 'c++', 'a'.repeat(15)]) {
      expect(usableExtension(extension), extension).toBe(true)
    }
  })

  // The save dialog throws a TypeError for an accept extension like these, dot included.
  it('refuses one that is empty, over 16 characters with its dot, or holds anything else', () => {
    for (const extension of ['', 'a'.repeat(16), 'final cut', 'mp4 ', 'm-v', 'vidéo', 'tar.gz', 'mp4~']) {
      expect(usableExtension(extension), extension).toBe(false)
    }
  })

  it('refuses no extension at all', () => {
    expect(usableExtension(null)).toBe(false)
  })
})

describe('outputName', () => {
  it('joins the stem, the suffix and the extension', () => {
    expect(outputName('holiday.mp4', '', 'm4a')).toBe('holiday.m4a')
    expect(outputName('holiday.mp4', ' (trimmed)', 'mp4')).toBe('holiday (trimmed).mp4')
  })

  it('never puts characters Windows refuses into the parts it makes', () => {
    expect(outputName('a.mp4', ' frame 0:01:23.456', 'png')).toBe('a frame 0-01-23.456.png')
    expect(outputName('a.mp4', ' <x>|"y"?*/\\', 'png')).toBe('a xy.png')
  })
})

describe('uniqueName', () => {
  it('keeps a name nobody has taken', () => {
    expect(uniqueName('holiday.m4a', ['other.m4a'])).toBe('holiday.m4a')
  })

  it('numbers repeats from 2, ignoring case', () => {
    expect(uniqueName('holiday.m4a', ['Holiday.M4A'])).toBe('holiday (2).m4a')
    expect(uniqueName('holiday.m4a', ['holiday.m4a', 'holiday (2).m4a'])).toBe('holiday (3).m4a')
  })

  it('numbers a name without an extension', () => {
    expect(uniqueName('clip', ['clip'])).toBe('clip (2)')
  })
})
