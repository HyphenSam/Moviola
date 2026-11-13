import { describe, expect, it } from 'vitest'
import { hasWebCodecs } from './webcodecs'

describe('hasWebCodecs', () => {
  it('needs VideoDecoder', () => {
    expect(hasWebCodecs({})).toBe(false)
    expect(hasWebCodecs({ VideoDecoder: class {} })).toBe(true)
  })
})
