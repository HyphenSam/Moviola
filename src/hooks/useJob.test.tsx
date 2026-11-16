// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JobPlan } from '@/lib/plan'
import { deferred, fakeClient, fakeInfo } from '@/lib/testing'
import { useJob } from './useJob'

const file = new File(['x'], 'a.mp4')
const plan = { kind: 'audio', name: 'a.m4a', mimeType: 'audio/mp4', lossless: true } as JobPlan

describe('useJob', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
  })

  /** A save dialog that stays open until the test settles it. */
  const openDialog = () => {
    const dialog = deferred<FileSystemFileHandle>()
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = () => dialog.promise
    return dialog
  }

  it('goes from idle through picking to running, and back to idle with an export', async () => {
    const dialog = openDialog()
    const client = fakeClient(() => fakeInfo())
    const { result } = renderHook(() => useJob(client))
    expect(result.current.state).toEqual({ phase: 'idle' })

    act(() => void result.current.start(file, plan, 'Extracting'))
    expect(result.current.state).toEqual({ phase: 'picking' })

    await act(async () => dialog.resolve({ name: 'b.m4a' } as FileSystemFileHandle))
    expect(result.current.state).toMatchObject({ phase: 'running', doing: 'Extracting', name: 'b.m4a' })

    await act(async () => client.jobs[0].finish({ size: 5, blob: null }))
    expect(result.current.state).toEqual({ phase: 'idle' })
    expect(result.current.exports).toMatchObject([{ name: 'b.m4a', size: 5, url: null }])
  })

  it('keeps a cancel made while the save dialog is open: the job never starts', async () => {
    const dialog = openDialog()
    const client = fakeClient(() => fakeInfo())
    const { result } = renderHook(() => useJob(client))
    act(() => void result.current.start(file, plan, 'Extracting'))

    act(() => result.current.cancel())
    // The dialog is still open, so the slot is still taken: a second dialog can't be opened over it.
    expect(result.current.state).toEqual({ phase: 'cancelling' })
    act(() => void result.current.start(file, plan, 'Extracting'))

    await act(async () => dialog.resolve({ name: 'b.m4a' } as FileSystemFileHandle))
    expect(client.jobs).toHaveLength(0)
    expect(result.current.state).toEqual({ phase: 'idle' })
    expect(result.current.exports).toEqual([])
  })
})
