// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deferred, fakeClient, fakeInfo } from '@/lib/testing'
import { useSource } from './useSource'

const file = (name: string) => new File(['x'], name)

describe('useSource', () => {
  it('probes the file and holds it with its info', async () => {
    const client = fakeClient((f) => fakeInfo({ name: f.name }))
    const { result } = renderHook(() => useSource(client))
    expect(result.current.source).toBeNull()

    act(() => result.current.open(file('a.mp4')))
    expect(result.current.opening?.name).toBe('a.mp4')
    await waitFor(() => expect(result.current.source?.info.name).toBe('a.mp4'))
    expect(result.current.source?.file.name).toBe('a.mp4')
    expect(result.current.opening).toBeNull()
    expect(client.probed.map((f) => f.name)).toEqual(['a.mp4'])
  })

  it('keeps the previous file open and gives the error when a file can’t be opened', async () => {
    const client = fakeClient((f) => {
      if (f.name.endsWith('.txt')) throw new Error('Moviola can’t open this file.')
      return fakeInfo({ name: f.name })
    })
    const { result } = renderHook(() => useSource(client))
    act(() => result.current.open(file('a.mp4')))
    await waitFor(() => expect(result.current.source?.info.name).toBe('a.mp4'))

    act(() => result.current.open(file('notes.txt')))
    await waitFor(() => expect(result.current.error).toBe('Moviola can’t open this file.'))
    expect(result.current.source?.info.name).toBe('a.mp4')
    expect(result.current.opening).toBeNull()

    act(() => result.current.dismissError())
    expect(result.current.error).toBeNull()
  })

  it('clears an earlier error when the next file opens', async () => {
    const client = fakeClient((f) => {
      if (f.name.endsWith('.txt')) throw new Error('No.')
      return fakeInfo({ name: f.name })
    })
    const { result } = renderHook(() => useSource(client))
    act(() => result.current.open(file('notes.txt')))
    await waitFor(() => expect(result.current.error).toBe('No.'))
    act(() => result.current.open(file('a.mp4')))
    await waitFor(() => expect(result.current.source?.info.name).toBe('a.mp4'))
    expect(result.current.error).toBeNull()
  })

  it('ignores a slow probe that a newer file has overtaken', async () => {
    const slow = deferred<ReturnType<typeof fakeInfo>>()
    const client = fakeClient((f) => (f.name === 'slow.mp4' ? slow.promise : fakeInfo({ name: f.name })))
    const { result } = renderHook(() => useSource(client))
    act(() => result.current.open(file('slow.mp4')))
    act(() => result.current.open(file('fast.mp4')))
    await waitFor(() => expect(result.current.source?.info.name).toBe('fast.mp4'))
    await act(async () => slow.resolve(fakeInfo({ name: 'slow.mp4' })))
    expect(result.current.source?.info.name).toBe('fast.mp4')
  })
})
