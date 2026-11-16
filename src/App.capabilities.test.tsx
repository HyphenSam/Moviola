// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { Capabilities } from './lib/capabilities'
import { WORKER_STOPPED, type WorkerCapabilities } from './lib/protocol'
import { ALL_CAPABLE, deferred, fakeClient, fakeFrames, fakeInfo } from './lib/testing'

const CHECKING = 'Checking what this browser can encode…'
const COULDNT_CHECK = 'Moviola couldn’t check what this browser can encode.'
const NOTHING: WorkerCapabilities = { encodeVideo: {}, encodeAudio: {}, encodeWebp: false }

const tool = (name: string) => within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name })
const option = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })
const action = (name: string) => screen.getByRole('button', { name })

/** Opens a 1080p H.264 + AAC MP4 with a worker whose answer about encoders the test settles: each
 * call to `capabilities` waits in `asked`. */
async function openWaiting() {
  const client = fakeClient((file) => ({ ...fakeInfo(), name: file.name }))
  const asked: ReturnType<typeof deferred<WorkerCapabilities>>[] = []
  client.capabilities = () => {
    asked.push(deferred<WorkerCapabilities>())
    return asked.at(-1)!.promise
  }
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'holiday.mp4'))
  await screen.findByRole('region', { name: 'Open file' })
  return { client, user, asked }
}

describe('Before the worker has said what this browser can encode', () => {
  it('keeps Precise chosen and says it’s checking, in place of “can’t encode”', async () => {
    const { user, asked } = await openWaiting()
    await user.click(tool('Trim'))
    // Fast copies, so it needs no answer.
    expect(action('Trim')).toBeEnabled()
    await user.click(option('Mode', 'Precise'))
    expect(option('Mode', 'Precise')).toBeChecked()
    expect(screen.getByText(CHECKING)).toBeInTheDocument()
    expect(screen.queryByText(/can’t encode/)).not.toBeInTheDocument()
    expect(action('Trim')).toBeDisabled()

    await act(async () => asked[0].resolve(ALL_CAPABLE))
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    expect(option('Mode', 'Precise')).toBeChecked()
    expect(action('Trim')).toBeEnabled()
  })

  it('keeps Extract audio’s format, waits for MP3, and lets Original through', async () => {
    const { user, asked } = await openWaiting()
    await user.click(tool('Extract audio'))
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    expect(action('Extract')).toBeEnabled()
    await user.click(option('Format', 'MP3'))
    expect(option('Format', 'MP3')).toBeChecked()
    expect(screen.getByText(CHECKING)).toBeInTheDocument()
    expect(action('Extract')).toBeDisabled()

    // The answer, once it comes, is what counts: this browser has no MP3 encoder.
    await act(async () => asked[0].resolve({ ...NOTHING, encodeAudio: { flac: true } }))
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    expect(screen.getByText('This browser can’t encode MP3.')).toBeInTheDocument()
    expect(option('Format', 'Original')).toBeChecked()
  })

  it('makes Compress wait, and shows a real problem straight away', async () => {
    const { user } = await openWaiting()
    await user.click(tool('Compress'))
    expect(screen.getByText(CHECKING)).toBeInTheDocument()
    expect(action('Compress')).toBeDisabled()
    // Lossless tools need no encoder.
    await user.click(tool('Change container'))
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    expect(action('Rewrap')).toBeEnabled()
  })

  it('says once that the check failed and offers to try again', async () => {
    const { user, asked } = await openWaiting()
    await user.click(tool('Compress'))
    await act(async () => asked[0].reject(new Error('boom')))
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent(COULDNT_CHECK)
    expect(screen.getAllByText(COULDNT_CHECK)).toHaveLength(1)
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    expect(screen.queryByText(/can’t encode video/)).not.toBeInTheDocument()
    expect(action('Compress')).toBeDisabled()

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(asked).toHaveLength(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText(CHECKING)).toBeInTheDocument()
    await act(async () => asked[1].resolve(ALL_CAPABLE))
    expect(action('Compress')).toBeEnabled()
  })
})

describe('Compress at a size the worker hasn’t answered for', () => {
  it('can’t start until the answer for that size arrives', async () => {
    const sizes: Record<string, ReturnType<typeof deferred<Capabilities['encodeVideo']>>> = {}
    const client = fakeClient((file) => ({ ...fakeInfo(), name: file.name }))
    client.encodable = ({ height }) => (sizes[height] ??= deferred()).promise
    const user = userEvent.setup()
    render(<App webCodecs client={client} frames={fakeFrames()} />)
    await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'holiday.mp4'))
    await screen.findByRole('region', { name: 'Open file' })
    await user.click(tool('Compress'))
    await act(async () => sizes[1080].resolve(ALL_CAPABLE.encodeVideo))
    expect(action('Compress')).toBeEnabled()

    await user.click(option('Resolution', '720p'))
    expect(screen.getByText(CHECKING)).toBeInTheDocument()
    expect(action('Compress')).toBeDisabled()
    await user.click(action('Compress'))
    expect(client.jobs).toHaveLength(0)

    // H.264 can't be encoded at 720p here, so the job that starts is HEVC's.
    await act(async () => sizes[720].resolve({ ...ALL_CAPABLE.encodeVideo, avc: false }))
    expect(screen.queryByText(CHECKING)).not.toBeInTheDocument()
    await user.click(action('Compress'))
    expect(client.jobs[0].plan).toMatchObject({ video: { codec: 'hevc', height: 720 } })
  })
})

describe('A worker that stopped', () => {
  /** A client whose worker failed to start: everything rejects, as `createClient` does. */
  function stoppedClient() {
    const client = fakeClient(() => Promise.reject(new Error(WORKER_STOPPED)))
    client.capabilities = () => Promise.reject(new Error(WORKER_STOPPED))
    client.encodable = () => Promise.reject(new Error(WORKER_STOPPED))
    return client
  }

  it('says so on the page before any file is opened, with nothing to retry', async () => {
    render(<App webCodecs client={stoppedClient()} frames={fakeFrames()} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(WORKER_STOPPED)
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('says so once when a file is opened', async () => {
    const user = userEvent.setup()
    render(<App webCodecs client={stoppedClient()} frames={fakeFrames()} />)
    await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'holiday.mp4'))
    expect(await screen.findByRole('alert')).toHaveTextContent(WORKER_STOPPED)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    expect(screen.queryByText(/^Opening/)).not.toBeInTheDocument()
  })

  it('says so on the card of a job that was running', async () => {
    const client = fakeClient((file) => ({ ...fakeInfo(), name: file.name }))
    const user = userEvent.setup()
    render(<App webCodecs client={client} frames={fakeFrames()} />)
    await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'holiday.mp4'))
    await screen.findByRole('region', { name: 'Open file' })
    await user.click(tool('Extract audio'))
    await user.click(action('Extract'))
    await act(async () => client.jobs[0].fail(WORKER_STOPPED))
    expect(within(screen.getByRole('region', { name: 'Exports' })).getByText(WORKER_STOPPED)).toBeInTheDocument()
    expect(action('Extract')).toBeEnabled()
  })
})
