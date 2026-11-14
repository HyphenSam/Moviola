// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import { fakeAudioTrack, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

const video = (name: string) => new File([new Uint8Array(16)], name, { type: 'video/mp4' })

/** Opens `info` (a 12.3 MB H.264 + AAC MP4 unless told otherwise) on `tool`. */
async function openOn(tool: string, info: MediaInfo = fakeInfo()) {
  const client = fakeClient((file) => ({ ...info, name: file.name }))
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), video(info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: tool }))
  return { client, user }
}

const latest = () => screen.getByRole('status', { name: 'Latest export' })

describe('accessibility', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
    vi.restoreAllMocks()
  })

  describe('finished jobs are announced', () => {
    it('says a result is ready to download', async () => {
      const { client, user } = await openOn('Extract audio')
      // The live region is there before anything is announced, or screen readers miss the first.
      expect(latest()).toBeEmptyDOMElement()
      await user.click(screen.getByRole('button', { name: 'Extract' }))
      await act(async () => client.jobs[0].finish({ size: 4, blob: new Blob(['x']) }))
      expect(latest()).toHaveTextContent('holiday.m4a is ready to download.')
    })

    it('says a result was saved', async () => {
      const handle = { name: 'holiday.m4a' } as FileSystemFileHandle
      ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = vi.fn(async () => handle)
      const { client, user } = await openOn('Extract audio')
      await user.click(screen.getByRole('button', { name: 'Extract' }))
      await act(async () => client.jobs[0].finish({ size: 4, blob: null }))
      expect(latest()).toHaveTextContent('Saved holiday.m4a.')
    })

    it('says why a job failed', async () => {
      const { client, user } = await openOn('Extract audio')
      await user.click(screen.getByRole('button', { name: 'Extract' }))
      await act(async () => client.jobs[0].fail('Something went wrong: disk full.'))
      expect(latest()).toHaveTextContent('holiday.m4a wasn’t made. Something went wrong: disk full.')
    })
  })

  it('keeps keyboard focus on the action while a job starts and ends', async () => {
    const { client, user } = await openOn('Extract audio')
    screen.getByRole('button', { name: 'Extract' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await act(async () => client.jobs[0].finish({ size: 4, blob: new Blob(['x']) }))
    expect(screen.getByRole('button', { name: 'Extract' })).toHaveFocus()
  })

  it('announces what stops a job, and the disabled action says why', async () => {
    const info = fakeInfo({
      tracks: [fakeVideoTrack(), fakeAudioTrack({ id: 2 }), fakeAudioTrack({ id: 3, language: 'fra' })],
    })
    const { user } = await openOn('Remove audio', info)
    const action = screen.getByRole('button', { name: 'Remove audio' })
    for (const box of screen.getAllByRole('checkbox')) await user.click(box)
    const problem = 'Every audio track is ticked, so nothing would be removed.'
    expect(screen.getByText(problem).closest('[aria-live]')).toHaveAttribute('aria-live', 'polite')
    expect(action).toBeDisabled()
    expect(action).toHaveAccessibleDescription(problem)
  })

  it('moves focus to the next export when one is removed from the keyboard', async () => {
    const { client, user } = await openOn('Extract audio')
    for (let i = 0; i < 2; i++) {
      await user.click(screen.getByRole('button', { name: 'Extract' }))
      await act(async () => client.jobs[i].finish({ size: 4, blob: new Blob(['x']) }))
    }
    // Newest first: holiday (2).m4a, then holiday.m4a.
    screen.getByRole('button', { name: 'Remove holiday (2).m4a' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Remove holiday.m4a' })).toHaveFocus()
  })
})
