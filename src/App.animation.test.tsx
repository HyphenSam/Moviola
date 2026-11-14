// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import type { WorkerCapabilities } from './lib/protocol'
import { ALL_CAPABLE, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

const tools = () => screen.getByRole('radiogroup', { name: 'Tools' })
const tool = (name: string) => within(tools()).getByRole('radio', { name })

/** Opens `info` (an 83.5 s, 25 fps, 1080p H.264 + AAC MP4 unless told otherwise) on Make animation. */
async function openOnAnimation(info: MediaInfo = fakeInfo(), capabilities: WorkerCapabilities = ALL_CAPABLE) {
  const client = fakeClient((file) => ({ ...info, name: file.name }), capabilities)
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(tool('Make animation'))
  return { client, user }
}

const inField = () => screen.getByRole('textbox', { name: 'In' })
const outField = () => screen.getByRole('textbox', { name: 'Out' })
const make = () => screen.getByRole('button', { name: 'Make GIF' })
const option = (group: string, name: string) =>
  within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })

async function type(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.clear(field)
  await user.type(field, `${text}{Enter}`)
}

describe('Make animation', () => {
  it('starts on a GIF of the first five seconds, 480 px at 15 fps, looping, labelled Re-encodes', async () => {
    await openOnAnimation()
    expect(option('Format', 'GIF')).toBeChecked()
    expect(inField()).toHaveValue('0:00.000')
    expect(outField()).toHaveValue('0:05.000')
    expect(option('Width', '480')).toBeChecked()
    expect(option('Frame rate', '15')).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Loop' })).toBeChecked()
    expect(screen.getByText('Re-encodes')).toBeInTheDocument()
    expect(screen.getByText('GIFs are limited to 256 colours.')).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'In point' })).toBeInTheDocument()
    expect(make()).toBeEnabled()
  })

  it('makes the GIF from the chosen range, width, rate and loop, counting progress', async () => {
    const { client, user } = await openOnAnimation()
    await type(user, inField(), '2')
    await type(user, outField(), '4.5')
    await user.click(option('Width', '640'))
    await user.click(option('Frame rate', '20'))
    await user.click(screen.getByRole('switch', { name: 'Loop' }))
    await user.click(make())
    expect(client.jobs[0].plan).toEqual({
      kind: 'animation',
      name: 'holiday.gif',
      mimeType: 'image/gif',
      lossless: false,
      start: 2,
      end: 4.5,
      width: 640,
      height: 360,
      frameRate: 20,
      loop: false,
    })
    expect(client.jobs[0].target).toEqual({ type: 'memory' })
    act(() => client.jobs[0].progress(0.5))
    expect(await screen.findByRole('progressbar', { name: 'Making GIF holiday.gif' })).toHaveAttribute(
      'aria-valuenow',
      '50',
    )
  })

  it('makes an animated WebP, saying so on the action and in its progress', async () => {
    const { client, user } = await openOnAnimation()
    await user.click(option('Format', 'WebP'))
    expect(
      screen.getByText('Full colour and smaller than a GIF, but some sites and apps take only GIFs.'),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Make WebP' }))
    expect(client.jobs[0].plan).toMatchObject({ kind: 'animation', name: 'holiday.webp', mimeType: 'image/webp' })
    act(() => client.jobs[0].progress(0.25))
    expect(await screen.findByRole('progressbar', { name: 'Making WebP holiday.webp' })).toBeInTheDocument()
  })

  it('offers no WebP where the browser can’t make one', async () => {
    await openOnAnimation(fakeInfo(), { ...ALL_CAPABLE, encodeWebp: false })
    expect(option('Format', 'WebP')).toBeDisabled()
  })

  it('shares its range with Trim: a trim range carries over, and so does an animation’s', async () => {
    const { user } = await openOnAnimation()
    await user.click(tool('Trim'))
    expect(outField()).toHaveValue('1:23.500')
    await type(user, inField(), '12.5')
    await user.click(tool('Make animation'))
    expect(inField()).toHaveValue('0:12.500')
    expect(outField()).toHaveValue('1:23.500')
    await type(user, outField(), '20')
    await user.click(tool('Trim'))
    expect(outField()).toHaveValue('0:20.000')
  })

  it('suggests a video past 15 seconds and stops past a minute', async () => {
    const { user } = await openOnAnimation()
    await type(user, outField(), '16')
    expect(screen.getByText('Long animations get large; consider a video instead.')).toBeInTheDocument()
    expect(make()).toBeEnabled()
    await type(user, outField(), '1:10')
    expect(
      screen.getByText('An animation can be at most a minute long, and this range is 1:10.000. Shorten it.'),
    ).toBeInTheDocument()
    expect(make()).toBeDisabled()
  })

  it('offers no width above the video’s own', async () => {
    await openOnAnimation(fakeInfo({ tracks: [fakeVideoTrack({ width: 400, height: 300 })] }))
    expect(option('Width', '320')).toBeChecked()
    expect(option('Width', '480')).toBeDisabled()
    expect(option('Width', '640')).toBeDisabled()
  })
})
