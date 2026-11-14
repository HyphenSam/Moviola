// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import type { WorkerCapabilities } from './lib/protocol'
import { ALL_CAPABLE, fakeAudioInfo, fakeClient, fakeFrames, fakeInfo } from './lib/testing'

const tools = () => screen.getByRole('radiogroup', { name: 'Tools' })

/** Opens `info` (an 83.5 s, 25 fps H.264 + AAC MP4 unless told otherwise) on Trim. */
async function openOnTrim(info: MediaInfo = fakeInfo(), capabilities?: WorkerCapabilities) {
  const client = fakeClient((file) => ({ ...info, name: file.name }), capabilities)
  const user = userEvent.setup()
  const view = render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(within(tools()).getByRole('radio', { name: 'Trim' }))
  return { client, user, view }
}

const inField = () => screen.getByRole('textbox', { name: 'In' })
const outField = () => screen.getByRole('textbox', { name: 'Out' })
const trim = () => screen.getByRole('button', { name: 'Trim' })
const modes = () => screen.getByRole('radiogroup', { name: 'Mode' })

async function type(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, `${text}{Enter}`)
}

describe('Trim', () => {
  it('starts on the whole file, Fast and lossless', async () => {
    await openOnTrim()
    expect(screen.getByRole('heading', { name: 'Trim' })).toBeInTheDocument()
    expect(inField()).toHaveValue('0:00.000')
    expect(outField()).toHaveValue('1:23.500')
    expect(screen.getByText('Length 1:23.500')).toBeInTheDocument()
    expect(within(modes()).getByRole('radio', { name: 'Fast' })).toBeChecked()
    expect(screen.getByText('Lossless')).toBeInTheDocument()
    expect(screen.getByText('Every track copied as is. No quality is lost.')).toBeInTheDocument()
    expect(trim()).toBeEnabled()
  })

  it('takes times typed in any form and writes them back in full', async () => {
    const { user } = await openOnTrim()
    await type(user, inField(), '12.5')
    expect(inField()).toHaveValue('0:12.500')
    await type(user, outField(), '1:00')
    expect(outField()).toHaveValue('1:00.000')
    expect(screen.getByText('Length 0:47.500')).toBeInTheDocument()
  })

  it('goes back to the last good time when what’s typed isn’t one, and keeps to the file', async () => {
    const { user } = await openOnTrim()
    await type(user, inField(), 'soon')
    expect(inField()).toHaveValue('0:00.000')
    await type(user, outField(), '5:00')
    expect(outField()).toHaveValue('1:23.500')
  })

  it('says where a fast trim really starts and marks it on the timeline, once the keyframe is found', async () => {
    const { client, user } = await openOnTrim()
    await type(user, inField(), '12.5')
    // The fake's keyframes are every 2 s.
    expect(
      await screen.findByText('Starts at 0:12.000, the nearest keyframe, 0.50 s before your in point.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Fast trim starts at 0:12.000' })).toBeInTheDocument()
    // Looked up once the in point settled: the whole file's 0 changed before its lookup was due.
    expect(client.keyframes.map((k) => [k.trackId, k.time])).toEqual([[1, 12.5]])
  })

  it('says nothing about keyframes when the in point is on one', async () => {
    const { client, user } = await openOnTrim()
    await type(user, inField(), '12')
    await waitFor(() => expect(client.keyframes.at(-1)?.time).toBe(12))
    expect(screen.queryByText(/nearest keyframe/)).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /Fast trim starts/ })).not.toBeInTheDocument()
  })

  it('trims the range, named after the source', async () => {
    const { client, user } = await openOnTrim()
    await type(user, inField(), '12.5')
    await type(user, outField(), '30')
    await user.click(trim())
    expect(client.jobs[0].plan).toMatchObject({
      name: 'holiday (trimmed).mp4',
      lossless: true,
      trim: { start: 12.5, end: 30 },
    })
    expect(await screen.findByRole('progressbar', { name: 'Trimming holiday (trimmed).mp4' })).toBeInTheDocument()
  })

  it('sets the in and out points to the playhead with the buttons and with I and O', async () => {
    const { user } = await openOnTrim()
    // Off the tool rail, whose radios take the arrow keys.
    await user.click(screen.getByRole('heading', { name: 'Trim' }))
    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}')
    await user.click(screen.getByRole('button', { name: 'Set in to playhead' }))
    expect(inField()).toHaveValue('0:03.000')
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    await user.click(screen.getByRole('button', { name: 'Set out to playhead' }))
    expect(outField()).toHaveValue('0:08.000')
    await user.keyboard('{ArrowLeft}i')
    expect(inField()).toHaveValue('0:07.000')
    await user.keyboard('{End}o')
    expect(outField()).toHaveValue('1:23.500')
  })

  it('moves the range with the timeline’s handles, which only the range tools show', async () => {
    const { user } = await openOnTrim()
    screen.getByRole('slider', { name: 'In point' }).focus()
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}{ArrowRight}')
    expect(inField()).toHaveValue('0:01.040')
    await user.click(within(tools()).getByRole('radio', { name: 'Media info' }))
    expect(screen.queryByRole('slider', { name: 'In point' })).not.toBeInTheDocument()
  })

  it('keeps the range while switching tools, and starts afresh for the next file', async () => {
    const { user } = await openOnTrim()
    await type(user, inField(), '10')
    await user.click(within(tools()).getByRole('radio', { name: 'Media info' }))
    await user.click(within(tools()).getByRole('radio', { name: 'Trim' }))
    expect(inField()).toHaveValue('0:10.000')

    await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'next.mp4'))
    await screen.findByRole('heading', { name: 'Media info' })
    await user.click(within(tools()).getByRole('radio', { name: 'Trim' }))
    expect(inField()).toHaveValue('0:00.000')
  })

  it('shows what stops the trim instead of running it', async () => {
    const { user } = await openOnTrim()
    await type(user, inField(), '40')
    await type(user, outField(), '30')
    expect(screen.getByText('The out point must be after the in point.')).toBeInTheDocument()
    expect(trim()).toBeDisabled()
  })

  it('re-encodes the video when Precise is chosen, and says so', async () => {
    const { client, user } = await openOnTrim()
    await type(user, inField(), '12.5')
    await user.click(within(modes()).getByRole('radio', { name: 'Precise' }))
    expect(screen.getByText('Re-encodes')).toBeInTheDocument()
    expect(screen.getByText('Video re-encoded, audio copied.')).toBeInTheDocument()
    expect(screen.queryByText(/nearest keyframe/)).not.toBeInTheDocument()
    await user.click(trim())
    expect(client.jobs[0].plan).toMatchObject({ lossless: false, video: { codec: 'avc' } })
  })

  it('disables Precise, saying why, when the browser can’t encode the video', async () => {
    await openOnTrim(fakeInfo(), { ...ALL_CAPABLE, encodeVideo: {} })
    expect(within(modes()).getByRole('radio', { name: 'Precise' })).toBeDisabled()
    expect(
      screen.getByText('This browser can’t encode H.264 video, so Precise isn’t available. Fast still works.'),
    ).toBeInTheDocument()
  })

  it('trims an audio file with no mode to choose', async () => {
    const { client, user } = await openOnTrim(fakeAudioInfo())
    expect(screen.queryByRole('radiogroup', { name: 'Mode' })).not.toBeInTheDocument()
    await type(user, outField(), '10')
    await user.click(trim())
    expect(client.jobs[0].plan).toMatchObject({
      name: 'song (trimmed).m4a',
      kind: 'audio',
      trim: { start: 0, end: 10 },
    })
    expect(client.keyframes).toEqual([])
  })

  it('seeks to the in point when its field changes, so the frame shows', async () => {
    const { user, view } = await openOnTrim()
    await type(user, inField(), '12.5')
    expect(view.container.querySelector('video')!.currentTime).toBe(12.5)
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuetext', '0:12.500')
  })

  it('follows the playhead as the video plays', async () => {
    const { view } = await openOnTrim()
    const video = view.container.querySelector('video')!
    act(() => {
      video.currentTime = 4
      fireEvent(video, new Event('timeupdate'))
    })
    expect(screen.getByRole('slider', { name: 'Playhead' })).toHaveAttribute('aria-valuenow', '4')
  })
})
