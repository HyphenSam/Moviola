// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { CANT_OPEN as PROBE_CANT_OPEN } from './media/probe'
import type { MediaInfo } from './lib/info'
import { deferred, fakeAudioInfo, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

const TOOLS = [
  'Media info',
  'Extract audio',
  'Trim',
  'Change container',
  'Remove audio',
  'Compress',
  'Grab frame',
  'Make animation',
]

const CANT_OPEN = 'Moviola can’t open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS video.'

const video = (name = 'holiday.mp4') => new File([new Uint8Array(16)], name, { type: 'video/mp4' })
const tools = () => within(screen.getByRole('radiogroup', { name: 'Tools' })).getAllByRole('radio')
const tool = (name: string) => within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name })

/** Probes answer from `infos` by file name, or with a 1080p MP4 named after the file. Names ending
 * .txt can't be opened. */
function setup(infos: Record<string, MediaInfo> = {}) {
  const client = fakeClient((file) => {
    if (file.name.endsWith('.txt')) throw new Error(CANT_OPEN)
    return infos[file.name] ?? fakeInfo({ name: file.name })
  })
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  return { client, user }
}

async function choose(user: ReturnType<typeof userEvent.setup>, file: File) {
  await user.upload(screen.getByLabelText('Choose file'), file)
}

const fileCard = () => screen.getByRole('region', { name: 'Open file' })

describe('App', () => {
  afterEach(() => {
    delete (window as { launchQueue?: unknown }).launchQueue
  })

  it('shows all eight tools, disabled until a file is open', () => {
    setup()
    expect(tools().map((t) => t.textContent)).toEqual(TOOLS)
    for (const t of tools()) expect(t).toBeDisabled()
  })

  it('names the same video formats on the stage as when a file can’t be opened', () => {
    setup()
    // "A, B, C and D video" or "A, B, C or D video": the names in it.
    const names = (text: string) =>
      text.match(/((?:[\w-]+, )*[\w-]+ (?:and|or) [\w-]+) video/)?.[1].split(/, | and | or /)
    const invite = screen.getByText(/paste from the clipboard/i).textContent!
    expect(names(invite)).toEqual(names(PROBE_CANT_OPEN))
    expect(names(invite)).toContain('MP4')
  })

  it('invites a video on the stage and says nothing is uploaded', () => {
    setup()
    expect(screen.getByText('Drop a video here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()
    expect(screen.getByText(/paste from the clipboard/i)).toBeInTheDocument()
    // Said once, on its own line, as on the sister sites.
    expect(screen.getByText(/nothing is uploaded/i)).toHaveTextContent(/^Runs on your device\. Nothing is uploaded\.$/)
  })

  it('opens a file chosen with the picker: the file card, the tools and Media info', async () => {
    const { client, user } = setup()
    expect(screen.getByLabelText('Choose file')).toHaveAttribute('accept', expect.stringContaining('.mkv'))
    await choose(user, video())

    expect(client.probed.map((f) => f.name)).toEqual(['holiday.mp4'])
    await waitFor(() => expect(fileCard()).toHaveTextContent('12.3 MB · 1:24 · 1920 × 1080'))
    expect(fileCard()).toHaveTextContent('holiday.mp4')
    expect(within(fileCard()).getByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.queryByText('Drop a video here')).not.toBeInTheDocument()
    for (const t of tools()) expect(t).toBeEnabled()
    expect(tool('Media info')).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Media info' })).toBeInTheDocument()
  })

  it('opens a file dropped anywhere on the window, whatever its extension', async () => {
    const { client } = setup()
    fireEvent.drop(window, { dataTransfer: { files: [new File(['x'], 'clip.weird')], types: ['Files'] } })
    await waitFor(() => expect(fileCard()).toHaveTextContent('clip.weird'))
    expect(client.probed.map((f) => f.name)).toEqual(['clip.weird'])
  })

  it('opens a file pasted anywhere on the page', async () => {
    const { client } = setup()
    fireEvent.paste(window, { clipboardData: { files: [video('pasted.mov')] } })
    await waitFor(() => expect(fileCard()).toHaveTextContent('pasted.mov'))
    expect(client.probed.map((f) => f.name)).toEqual(['pasted.mov'])
  })

  it('leaves a paste with no files alone', () => {
    const { client } = setup()
    fireEvent.paste(window, { clipboardData: { files: [] } })
    expect(client.probed).toEqual([])
  })

  it('opens a file the installed app was launched with', async () => {
    let consumer: ((params: { files: { getFile(): Promise<File> }[] }) => void) | undefined
    ;(window as { launchQueue?: unknown }).launchQueue = { setConsumer: (fn: typeof consumer) => (consumer = fn) }
    setup()
    await act(async () => consumer?.({ files: [{ getFile: async () => video('launched.mov') }] }))
    await waitFor(() => expect(fileCard()).toHaveTextContent('launched.mov'))
  })

  it('says it can’t open a file that isn’t media, and keeps the open file', async () => {
    const { user } = setup()
    await choose(user, video())
    await within(fileCard()).findByText(/1920 × 1080/)

    fireEvent.drop(window, { dataTransfer: { files: [new File(['x'], 'notes.txt')], types: ['Files'] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(CANT_OPEN)
    expect(fileCard()).toHaveTextContent('holiday.mp4')

    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('says it can’t open a file when nothing is open yet, and still invites one', async () => {
    setup()
    fireEvent.drop(window, { dataTransfer: { files: [new File(['x'], 'notes.txt')], types: ['Files'] } })
    expect(await screen.findByRole('alert')).toHaveTextContent(CANT_OPEN)
    expect(screen.getByText('Drop a video here')).toBeInTheDocument()
  })

  it('says which file is opening while it is probed', async () => {
    const slow = deferred<MediaInfo>()
    const client = fakeClient(() => slow.promise)
    const user = userEvent.setup()
    render(<App webCodecs client={client} frames={fakeFrames()} />)
    await choose(user, video('big.mkv'))
    // The exports strip's live region is a status too; this one names the file.
    expect(screen.getByText('Opening big.mkv…').closest('[role="status"]')).toBeInTheDocument()
    await act(async () => slow.resolve(fakeInfo({ name: 'big.mkv' })))
    expect(screen.queryByText('Opening big.mkv…')).not.toBeInTheDocument()
  })

  it('opens an audio file in Convert audio and dims the tools that need a picture, saying why', async () => {
    const { user } = setup({ 'song.m4a': fakeAudioInfo() })
    await choose(user, new File(['x'], 'song.m4a'))
    await waitFor(() => expect(tool('Convert audio')).toBeChecked())
    expect(fileCard()).toHaveTextContent('12.3 MB · 1:24 · 48 kHz, stereo')
    for (const name of ['Change container', 'Remove audio', 'Compress', 'Grab frame', 'Make animation']) {
      expect(tool(name)).toHaveAttribute('aria-disabled', 'true')
      expect(tool(name)).toHaveAccessibleDescription('This file has no video.')
    }
    expect(tool('Media info')).not.toHaveAttribute('aria-disabled')

    await user.click(tool('Compress'))
    expect(tool('Convert audio')).toBeChecked()
  })

  it('starts the file card afresh for each file, so an audio file never keeps a video’s thumbnail', async () => {
    // A canvas that can draw, so the video's thumbnail lands.
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as unknown as typeof getContext
    try {
      const { user } = setup({ 'song.m4a': fakeAudioInfo() })
      await choose(user, video())
      await waitFor(() => expect(fileCard().querySelector('canvas:not(.hidden)')).not.toBeNull())
      await choose(user, new File(['x'], 'song.m4a'))
      await waitFor(() => expect(fileCard()).toHaveTextContent('song.m4a'))
      expect(fileCard().querySelector('svg.lucide-audio-lines')).not.toBeNull()
    } finally {
      HTMLCanvasElement.prototype.getContext = getContext
    }
  })

  it('dims Extract audio for a video with no audio track', async () => {
    const { user } = setup({ 'silent.mp4': fakeInfo({ name: 'silent.mp4', tracks: [fakeVideoTrack()] }) })
    await choose(user, video('silent.mp4'))
    await waitFor(() => expect(tool('Extract audio')).toHaveAttribute('aria-disabled', 'true'))
    expect(tool('Extract audio')).toHaveAccessibleDescription('This file has no audio track.')
  })

  it('picks another tool when one is clicked', async () => {
    const { user } = setup()
    await choose(user, video())
    await waitFor(() => expect(tool('Media info')).toBeChecked())
    await user.click(tool('Trim'))
    expect(tool('Trim')).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Trim' })).toBeInTheDocument()
  })

  it('goes back to the default tool when the next file opens', async () => {
    const { user } = setup()
    await choose(user, video())
    await waitFor(() => expect(tool('Media info')).toBeChecked())
    await user.click(tool('Trim'))
    await choose(user, video('next.mp4'))
    await waitFor(() => expect(fileCard()).toHaveTextContent('next.mp4'))
    expect(tool('Media info')).toBeChecked()
  })

  it('shows the media info and copies it as text', async () => {
    const { user } = setup()
    await choose(user, video())
    const view = await screen.findByRole('region', { name: 'Media info' })
    expect(within(view).getByText('H.264 High')).toBeInTheDocument()
    expect(within(view).getByText('avc1.640028')).toBeInTheDocument()
    expect(within(view).getByText('48 kHz, stereo')).toBeInTheDocument()

    await user.click(within(view).getByRole('button', { name: 'Copy as text' }))
    const copied = await navigator.clipboard.readText()
    expect(copied).toContain('Name: holiday.mp4')
    expect(copied).toContain('Codec: H.264 High (avc1.640028)')
    expect(within(view).getByRole('button', { name: 'Copied' })).toBeInTheDocument()
  })

  it('checks whether a WebM’s frames change size as it plays, and says so in Media info', async () => {
    const webm = fakeInfo({
      name: 'shrinks.webm',
      container: 'webm',
      tracks: [fakeVideoTrack({ codec: 'vp9', codecString: 'vp09.00.10.08', width: 960, height: 720 })],
    })
    const { client, user } = setup({ 'shrinks.webm': webm })
    const file = video('shrinks.webm')
    await choose(user, file)
    const view = await screen.findByRole('region', { name: 'Media info' })
    expect(within(view).getByText('Checking for size changes…')).toBeInTheDocument()
    expect(client.scans).toMatchObject([{ file, trackId: 1 }])

    await act(async () =>
      client.scans[0].finish({
        smallest: { width: 960, height: 1 },
        largest: { width: 960, height: 720 },
        changes: 90,
      }),
    )
    expect(within(view).getByText('960 × 720, changes as it plays')).toBeInTheDocument()
    expect(within(view).getByText('960 × 1 to 960 × 720, 90 changes')).toBeInTheDocument()
    expect(within(view).queryByText('Checking for size changes…')).not.toBeInTheDocument()

    await user.click(within(view).getByRole('button', { name: 'Copy as text' }))
    expect(await navigator.clipboard.readText()).toContain(
      'Size: 960 × 720, changes as it plays (960 × 1 to 960 × 720, 90 changes)',
    )
  })

  it('shows the size alone once a check finds no change, or fails', async () => {
    const vp9 = (name: string) =>
      fakeInfo({ name, container: 'webm', tracks: [fakeVideoTrack({ codec: 'vp9', width: 640, height: 360 })] })
    const { client, user } = setup({ 'same.webm': vp9('same.webm'), 'broken.webm': vp9('broken.webm') })
    await choose(user, video('same.webm'))
    await act(async () => client.scans[0].finish(null))
    const view = await screen.findByRole('region', { name: 'Media info' })
    expect(within(view).getByText('640 × 360')).toBeInTheDocument()
    expect(within(view).queryByText('Checking for size changes…')).not.toBeInTheDocument()

    await choose(user, video('broken.webm'))
    await act(async () => client.scans[1].fail('Something went wrong'))
    expect(within(screen.getByRole('region', { name: 'Media info' })).getByText('640 × 360')).toBeInTheDocument()
    expect(screen.queryByText('Checking for size changes…')).not.toBeInTheDocument()
  })

  it('stops checking a file’s sizes when another opens, and doesn’t check codecs it can’t read', async () => {
    const webm = fakeInfo({ name: 'a.webm', container: 'webm', tracks: [fakeVideoTrack({ codec: 'av1' })] })
    const { client, user } = setup({ 'a.webm': webm })
    await choose(user, video('a.webm'))
    await waitFor(() => expect(client.scans).toHaveLength(1))
    await choose(user, video('holiday.mp4'))
    await screen.findByText('holiday.mp4')
    expect(client.scans[0].cancelled).toBe(true)
    // H.264: no scan, and nothing said about one.
    expect(client.scans).toHaveLength(1)
    expect(screen.queryByText('Checking for size changes…')).not.toBeInTheDocument()

    // A late answer for the first file changes nothing.
    await act(async () =>
      client.scans[0].finish({ smallest: { width: 1, height: 1 }, largest: { width: 1920, height: 1080 }, changes: 1 }),
    )
    expect(screen.queryByText(/changes as it plays/)).not.toBeInTheDocument()
  })

  it('says the browser is too old when it has no WebCodecs, and offers nothing else', () => {
    const client = fakeClient(() => fakeInfo())
    render(<App webCodecs={false} client={client} frames={fakeFrames()} />)
    expect(screen.getByText(/This browser is too old/)).toBeInTheDocument()
    expect(screen.getByText(/Chrome or Edge 94, Firefox 130 or Safari 16\.4/)).toBeInTheDocument()
    expect(screen.queryByText('Drop a video here')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose file' })).not.toBeInTheDocument()

    fireEvent.drop(window, { dataTransfer: { files: [video()], types: ['Files'] } })
    expect(client.probed).toEqual([])
  })

  it('offers the theme menu, About and the sister apps in the header', () => {
    setup()
    const header = within(screen.getByRole('banner'))
    expect(header.getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Theme', 'About', 'Apps'])
  })

  it('credits Mediabunny and the encoder libraries in About', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'About' }))
    const about = screen.getByRole('dialog')
    for (const name of ['Mediabunny', 'LAME', 'libFLAC', 'FFmpeg', 'gifenc']) {
      expect(within(about).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })
})
