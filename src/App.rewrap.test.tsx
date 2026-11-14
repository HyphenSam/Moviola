// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import { fakeAudioTrack, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

/** Opens `info` on the tool named `tool`. */
async function openOn(tool: string, info: MediaInfo) {
  const client = fakeClient((file) => ({ ...info, name: file.name }))
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: tool }))
  return { client, user }
}

// H.264 with English stereo AAC and French 5.1 AC-3, in MKV.
const film = () =>
  fakeInfo({
    name: 'film.mkv',
    container: 'mkv',
    tracks: [
      fakeVideoTrack(),
      fakeAudioTrack({ id: 2, language: 'eng' }),
      fakeAudioTrack({ id: 3, language: 'fra', isDefault: false, codec: 'ac3', channels: 6, canDecode: false }),
    ],
  })

const containers = () => screen.getByRole('radiogroup', { name: 'Container' })
const container = (name: string) => within(containers()).getByRole('radio', { name })
const rewrap = () => screen.getByRole('button', { name: 'Rewrap' })

describe('Change container', () => {
  it('offers MP4 first, with the source’s own container disabled, and every track ticked', async () => {
    await openOn('Change container', film())
    expect(screen.getByRole('heading', { name: 'Change container' })).toBeInTheDocument()
    expect(container('MP4')).toBeChecked()
    expect(container('MKV')).toBeDisabled()
    expect(screen.getByText('Already MKV.')).toBeInTheDocument()
    for (const name of ['Video · H.264', 'Audio · AAC · English', 'Audio · AC-3 · French']) {
      const box = screen.getByRole('checkbox', { name })
      expect(box).toBeChecked()
      expect(box).toBeEnabled()
    }
    expect(screen.getByText('Subtitles other than WebVTT aren’t carried over.')).toBeInTheDocument()
    expect(screen.getByText('Lossless')).toBeInTheDocument()
    expect(rewrap()).toBeEnabled()
  })

  it('rewraps the ticked tracks into the chosen container', async () => {
    const { client, user } = await openOn('Change container', film())
    await user.click(screen.getByRole('checkbox', { name: 'Audio · AC-3 · French' }))
    expect(screen.getByRole('checkbox', { name: 'Audio · AC-3 · French' })).not.toBeChecked()
    await user.click(container('MOV'))
    await user.click(rewrap())
    expect(client.jobs[0].plan).toMatchObject({ container: 'mov', name: 'film.mov', keep: [1, 2], lossless: true })
  })

  it('unticks and disables what WebM can’t hold, says why, and refuses without the video', async () => {
    const { user } = await openOn('Change container', film())
    await user.click(container('WebM'))
    const video = screen.getByRole('checkbox', { name: 'Video · H.264' })
    expect(video).not.toBeChecked()
    expect(video).toBeDisabled()
    expect(video).toHaveAccessibleDescription('WebM can’t hold H.264')
    expect(screen.getByRole('checkbox', { name: 'Audio · AC-3 · French' })).toHaveAccessibleDescription(
      'WebM can’t hold AC-3',
    )
    expect(
      screen.getByText('WebM can’t hold this video’s H.264. Use Compress to convert it to VP9 or AV1.'),
    ).toBeInTheDocument()
    expect(rewrap()).toBeDisabled()
  })

  it('starts on MKV for an MP4, and says nothing about subtitles', async () => {
    await openOn('Change container', fakeInfo())
    expect(container('MKV')).toBeChecked()
    expect(container('MP4')).toBeDisabled()
    expect(screen.getByText('Already MP4.')).toBeInTheDocument()
    expect(screen.queryByText(/Subtitles other than WebVTT/)).not.toBeInTheDocument()
  })
})

const removeAudio = () => screen.getByRole('button', { name: 'Remove audio' })

describe('Remove audio', () => {
  it('needs no settings for a single audio track', async () => {
    const { client, user } = await openOn('Remove audio', fakeInfo())
    expect(screen.getByRole('heading', { name: 'Remove audio' })).toBeInTheDocument()
    expect(screen.getByText('Copies the video without its audio. Nothing is re-encoded.')).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText('Lossless')).toBeInTheDocument()
    await user.click(removeAudio())
    expect(client.jobs[0].plan).toMatchObject({ name: 'holiday (no audio).mp4', keep: [1] })
  })

  it('lists several audio tracks to keep, none ticked, so all go unless the user keeps one', async () => {
    const { client, user } = await openOn('Remove audio', film())
    const english = screen.getByRole('checkbox', { name: 'Keep English · AAC · stereo' })
    const french = screen.getByRole('checkbox', { name: 'Keep French · AC-3 · 5.1' })
    expect(english).not.toBeChecked()
    expect(french).not.toBeChecked()
    await user.click(french)
    expect(french).toBeChecked()
    await user.click(removeAudio())
    expect(client.jobs[0].plan).toMatchObject({ name: 'film (edited).mkv', keep: [1, 3] })
  })

  it('refuses when every track is kept', async () => {
    const { user } = await openOn('Remove audio', film())
    await user.click(screen.getByRole('checkbox', { name: 'Keep English · AAC · stereo' }))
    await user.click(screen.getByRole('checkbox', { name: 'Keep French · AC-3 · 5.1' }))
    expect(screen.getByText('Every audio track is ticked, so nothing would be removed.')).toBeInTheDocument()
    expect(removeAudio()).toBeDisabled()
  })
})
