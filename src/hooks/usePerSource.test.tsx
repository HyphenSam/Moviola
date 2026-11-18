// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { usePerSource } from './usePerSource'

describe('usePerSource', () => {
  it('holds nothing until a value is set for the open file', () => {
    const { result } = renderHook(() => usePerSource<number>({ id: 1 }))
    expect(result.current[0]).toBeUndefined()
    act(() => result.current[1](7))
    expect(result.current[0]).toBe(7)
  })

  // Every open has a new id, the same file opened again included.
  it('starts afresh for the next open, and holds nothing with no file open', () => {
    const { result, rerender } = renderHook(({ source }) => usePerSource<number>(source), {
      initialProps: { source: { id: 1 } as { id: number } | null },
    })
    act(() => result.current[1](7))
    rerender({ source: { id: 2 } })
    expect(result.current[0]).toBeUndefined()
    act(() => result.current[1](8))
    expect(result.current[0]).toBe(8)
    rerender({ source: null })
    expect(result.current[0]).toBeUndefined()
  })

  it('ignores a value set with no file open', () => {
    const { result, rerender } = renderHook(({ source }) => usePerSource<number>(source), {
      initialProps: { source: null as { id: number } | null },
    })
    act(() => result.current[1](7))
    rerender({ source: { id: 1 } })
    expect(result.current[0]).toBeUndefined()
  })
})
