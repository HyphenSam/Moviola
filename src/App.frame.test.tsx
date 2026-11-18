// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import type { WorkerCapabilities } from './lib/protocol'
import { ALL_CAPABLE, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

const tools = () => screen.getByRole('radiogroup', { name: 'Tools' })

/** Opens `info` (an 83.5 s, 25 fps, 1080p H.264 + AAC MP4 unless told otherwise) on Grab frame. */
async function openOnFrame(info: MediaInfo = fakeInfo(), capabilities: WorkerCapabilities = ALL_CAPABLE) {
  const client = fakeClient((file) => ({ ...info, name: file.name }), capabilities)
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(within(tools()).getByRole('radio', { name: 'Grab frame' }))
  return { client, user }
}

const save = () => screen.getByRole('button', { name: 'Save frame' })
const format = (name: string) => within(screen.getByRole('radiogroup', { name: 'Format' })).getByRole('radio', { name })
const settings = () => screen.getByRole('region', { name: 'Grab frame' })

describe('Grab frame', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
    delete (window as { ClipboardItem?: unknown }).ClipboardItem
    vi.restoreAllMocks()
  })

  it('shows the playhead’s time and saves a full-size PNG by default, with no Lossless or Re-encodes badge', async () => {
    await openOnFrame()
    expect(within(settings()).getByText('0:00.000')).toBeInTheDocument()
    expect(format('PNG')).toBeChecked()
    expect(screen.getByText('The full 1920 × 1080 frame.')).toBeInTheDocument()
    expect(save()).toBeEnabled()
    expect(screen.queryByText('Lossless')).not.toBeInTheDocument()
    expect(screen.queryByText('Re-encodes')).not.toBeInTheDocument()
  })

  it('steps a frame at a time beside the time, and grabs the frame at the playhead', async () => {
    const { client, user } = await openOnFrame()
    await user.click(within(settings()).getByRole('button', { name: 'Next frame' }))
    await user.click(within(settings()).getByRole('button', { name: 'Next frame' }))
    await user.click(within(settings()).getByRole('button', { name: 'Previous frame' }))
    expect(within(settings()).getByText('0:00.040')).toBeInTheDocument()
    await user.click(format('JPEG'))
    await user.click(save())
    expect(client.jobs[0].plan).toEqual({
      kind: 'frame',
      name: 'holiday frame 0-00-00.040.jpg',
      mimeType: 'image/jpeg',
      quality: 0.9,
      lossless: false,
      time: 0.04,
    })
  })

  it('saves a WebP at quality 90, or losslessly with the switch on', async () => {
    const { client, user } = await openOnFrame()
    expect(screen.queryByRole('switch', { name: 'Lossless' })).not.toBeInTheDocument()
    await user.click(format('WebP'))
    expect(screen.getByText('A smaller file, at quality 90.')).toBeInTheDocument()
    await user.click(save())
    expect(client.jobs[0].plan).toMatchObject({
      name: 'holiday frame 0-00-00.000.webp',
      mimeType: 'image/webp',
      quality: 0.9,
    })
    await user.click(screen.getByRole('switch', { name: 'Lossless' }))
    expect(screen.getByText('Every pixel as decoded, in a smaller file than PNG.')).toBeInTheDocument()
    await act(async () => client.jobs[0].finish({ size: 3, blob: new Blob(['webp']) }))
    await user.click(save())
    expect(client.jobs[1].plan).toMatchObject({ mimeType: 'image/webp', quality: 1 })
  })

  it('offers no WebP where the browser can’t make one', async () => {
    await openOnFrame(fakeInfo(), { ...ALL_CAPABLE, encodeWebp: false })
    expect(format('WebP')).toBeDisabled()
  })

  it('builds the image in memory without the save dialog, and offers it to download', async () => {
    const picker = vi.fn()
    ;(window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = picker
    const { client, user } = await openOnFrame()
    await user.click(save())
    expect(picker).not.toHaveBeenCalled()
    expect(client.jobs[0].target).toEqual({ type: 'memory' })
    await act(async () => client.jobs[0].finish({ size: 2_000_000, blob: new Blob(['png']) }))
    const strip = screen.getByRole('region', { name: 'Exports' })
    expect(within(strip).getByText('holiday frame 0-00-00.000.png')).toBeInTheDocument()
    expect(within(strip).getByRole('link', { name: 'Download' })).toBeInTheDocument()
    // An image's size says nothing about the video's, so there's no change to show.
    expect(within(strip).getByText('2 MB')).toBeInTheDocument()
  })

  it('copies the frame to the clipboard as a PNG, without adding an export', async () => {
    const written: unknown[] = []
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob>>) {}
    }
    ;(window as unknown as { ClipboardItem: unknown }).ClipboardItem = FakeClipboardItem
    const { client, user } = await openOnFrame()
    // After user-event's setup, which puts its own clipboard in place.
    const write = vi.fn(async (items: unknown[]) => void written.push(...items))
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ write } as unknown as Clipboard)
    await user.click(format('JPEG'))
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(client.jobs[0].plan).toMatchObject({ kind: 'frame', mimeType: 'image/png' })
    const png = new Blob(['png'], { type: 'image/png' })
    await act(async () => client.jobs[0].finish({ size: 3, blob: png }))
    expect(await (written[0] as FakeClipboardItem).items['image/png']).toBe(png)
    expect(await screen.findByText('Copied the frame.')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Exports' })).not.toBeInTheDocument()
  })

  it('disables Copy and Save frame while a copy is in flight, so a job and a copy never run together', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob>>) {}
    }
    ;(window as unknown as { ClipboardItem: unknown }).ClipboardItem = FakeClipboardItem
    const { client, user } = await openOnFrame()
    // The write lasts as long as the image takes, as a real clipboard's does.
    const write = vi.fn(async ([item]: FakeClipboardItem[]) => void (await item.items['image/png']))
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ write } as unknown as Clipboard)
    const copy = () => screen.getByRole('button', { name: 'Copy' })

    await user.click(copy())
    expect(copy()).toBeDisabled()
    expect(save()).toBeDisabled()
    await user.click(copy())
    await user.click(save())
    expect(client.jobs).toHaveLength(1)

    await act(async () => client.jobs[0].finish({ size: 3, blob: new Blob(['png'], { type: 'image/png' }) }))
    expect(await screen.findByText('Copied the frame.')).toBeInTheDocument()
    expect(copy()).toBeEnabled()
    expect(save()).toBeEnabled()
  })

  it('says so when no image comes back to copy', async () => {
    class FakeClipboardItem {
      constructor(public items: Record<string, Promise<Blob>>) {}
    }
    ;(window as unknown as { ClipboardItem: unknown }).ClipboardItem = FakeClipboardItem
    const { client, user } = await openOnFrame()
    const write = vi.fn(async ([item]: FakeClipboardItem[]) => void (await item.items['image/png']))
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ write } as unknown as Clipboard)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await act(async () => client.jobs[0].finish({ size: 0, blob: null }))
    expect(await screen.findByText('The frame couldn’t be copied: no image came back.')).toBeInTheDocument()
  })

  it('says so in plain words when the browser refuses the clipboard', async () => {
    ;(window as unknown as { ClipboardItem: unknown }).ClipboardItem = class {}
    const { user } = await openOnFrame()
    const write = vi.fn(async () => {
      throw new DOMException('Failed to execute ’write’ on ’Clipboard’: Write permission denied.', 'NotAllowedError')
    })
    vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ write } as unknown as Clipboard)
    await user.click(screen.getByRole('button', { name: 'Copy' }))
    expect(
      await screen.findByText('The browser didn’t allow copying to the clipboard. Save the frame instead.'),
    ).toBeInTheDocument()
  })

  it('has no Copy button where the browser can’t put images on the clipboard', async () => {
    await openOnFrame()
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()
  })

  it('says HDR frames are converted to SDR', async () => {
    await openOnFrame(fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', colour: { transfer: 'pq', hdr: true } })] }))
    expect(screen.getByText('The full 1920 × 1080 frame. HDR frames are converted to SDR.')).toBeInTheDocument()
  })

  it('says why it can’t grab a frame from video this browser can’t decode', async () => {
    await openOnFrame(fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] }))
    expect(screen.getByText('This browser can’t decode HEVC, so it can’t show a frame.')).toBeInTheDocument()
    await waitFor(() => expect(save()).toBeDisabled())
  })
})
