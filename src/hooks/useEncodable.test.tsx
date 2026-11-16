// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Capabilities } from '@/lib/capabilities'
import type { Size } from '@/lib/protocol'
import { deferred, fakeClient, fakeInfo } from '@/lib/testing'
import { useEncodable } from './useEncodable'

const HD: Size = { width: 1280, height: 720 }
const SD: Size = { width: 854, height: 480 }

/** A client whose answers per size the test settles; `asked` lists every question. */
function setup() {
  const client = fakeClient(() => fakeInfo())
  const asked: (Size & ReturnType<typeof deferred<Capabilities['encodeVideo']>>)[] = []
  client.encodable = (size) => {
    asked.push({ ...size, ...deferred<Capabilities['encodeVideo']>() })
    return asked.at(-1)!.promise
  }
  const hook = renderHook(({ size, settings }) => useEncodable(client, size, settings), {
    initialProps: { size: HD as Size | null, settings: 'a' },
  })
  return { asked, ...hook }
}

describe('useEncodable', () => {
  it('is pending from the first render until the worker answers, and asks once per size', async () => {
    const { asked, result, rerender } = setup()
    expect(result.current).toEqual({ encoders: null, pending: true })
    await act(async () => asked[0].resolve({ avc: true }))
    expect(result.current).toEqual({ encoders: { avc: true }, pending: false })

    rerender({ size: SD, settings: 'a' })
    expect(result.current).toEqual({ encoders: null, pending: true })
    await act(async () => asked[1].resolve({ avc: false }))
    rerender({ size: HD, settings: 'b' })
    expect(result.current).toEqual({ encoders: { avc: true }, pending: false })
    expect(asked).toHaveLength(2)
  })

  it('asks nothing when there’s no size', () => {
    const { asked, result } = setup()
    expect(asked).toHaveLength(1)
    const none = renderHook(() => useEncodable(fakeClient(() => fakeInfo()), null, 'a'))
    expect(none.result.current).toEqual({ encoders: null, pending: false })
    expect(result.current.pending).toBe(true)
  })

  it('stops waiting when the question fails, and asks again on the next change', async () => {
    const { asked, result, rerender } = setup()
    await act(async () => asked[0].reject(new Error('boom')))
    expect(result.current).toEqual({ encoders: null, pending: false })
    // Nothing changed: the same question isn't hammered.
    rerender({ size: HD, settings: 'a' })
    expect(asked).toHaveLength(1)

    rerender({ size: HD, settings: 'b' })
    expect(asked).toHaveLength(2)
    expect(result.current.pending).toBe(true)
    await act(async () => asked[1].resolve({ avc: true }))
    expect(result.current).toEqual({ encoders: { avc: true }, pending: false })
  })
})
