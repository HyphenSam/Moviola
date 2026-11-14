// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import type { Size } from './lib/protocol'
import { ALL_CAPABLE, fakeAudioTrack, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

/** Opens `info` (a 12.3 MB, 1:23.5 1080p H.264 + AAC MP4 unless told otherwise) on Compress. The file
 * itself is a few bytes unless `bytes` says otherwise; exports compare results with its size. */
async function openOnCompress(
  info: MediaInfo = fakeInfo(),
  encodable?: (size: Size) => Partial<Record<'avc' | 'hevc' | 'vp9' | 'av1', boolean>>,
  bytes = 16,
) {
  const client = fakeClient((file) => ({ ...info, name: file.name }), ALL_CAPABLE, encodable)
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(bytes)], info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: 'Compress' }))
  return { client, user }
}

const group = (name: string) => screen.getByRole('radiogroup', { name })
const option = (groupName: string, name: string) => within(group(groupName)).getByRole('radio', { name })
const compress = () => screen.getByRole('button', { name: 'Compress' })

describe('Compress', () => {
  it('starts on Quality, Balanced, at the original size, says it re-encodes and what’s copied', async () => {
    const { client, user } = await openOnCompress()
    expect(screen.getByRole('heading', { name: 'Compress' })).toBeInTheDocument()
    expect(option('Aim', 'Quality')).toBeChecked()
    expect(option('Quality', 'Balanced')).toBeChecked()
    expect(option('Resolution', 'Original')).toBeChecked()
    expect(option('Audio', 'Keep')).toBeChecked()
    expect(screen.getByText('Re-encodes')).toBeInTheDocument()
    expect(screen.getByText('Video re-encoded to H.264, audio copied.')).toBeInTheDocument()
    await user.click(compress())
    expect(client.jobs[0].plan).toMatchObject({
      name: 'holiday (compressed).mp4',
      video: { codec: 'avc', bitrate: 3_227_000, width: 1920, height: 1080 },
    })
  })

  it('disables sizes above the source', async () => {
    await openOnCompress(fakeInfo({ tracks: [fakeVideoTrack({ width: 1280, height: 720 }), fakeAudioTrack()] }))
    expect(option('Resolution', '1080p')).toBeDisabled()
    expect(option('Resolution', '720p')).toBeEnabled()
  })

  it('aims for a target size, starting at half the file, with quick picks', async () => {
    const { client, user } = await openOnCompress(fakeInfo({ size: 40_000_000, duration: 20 }))
    await user.click(option('Aim', 'Target size'))
    const field = screen.getByRole('spinbutton', { name: 'Target size' })
    expect(field).toHaveValue(20)
    await user.click(screen.getByRole('button', { name: '10 MB' }))
    expect(field).toHaveValue(10)
    expect(screen.getByText(/^About [0-9.]+ [kM]bps for the video\.$/)).toBeInTheDocument()
    await user.click(compress())
    expect(client.jobs[0].plan.sizeCheck).toEqual({ target: 10_000_000 })
  })

  it('refuses a target too small for the length and size, and says what to try', async () => {
    const { user } = await openOnCompress(fakeInfo({ duration: 240 }))
    await user.click(option('Aim', 'Target size'))
    const field = screen.getByRole('spinbutton', { name: 'Target size' })
    await user.clear(field)
    await user.type(field, '12{Enter}')
    expect(
      screen.getByText('12 MB is too small for 4 minutes at 1080p. Try 480p or a larger size.'),
    ).toBeInTheDocument()
    expect(compress()).toBeDisabled()
    await user.click(option('Resolution', '480p'))
    expect(compress()).toBeEnabled()
  })

  it('keeps frame rate and codec behind More options', async () => {
    const { client, user } = await openOnCompress(
      fakeInfo({ tracks: [fakeVideoTrack({ frameRate: 60 }), fakeAudioTrack()] }),
    )
    expect(screen.queryByRole('radiogroup', { name: 'Codec' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'More options' }))
    expect(option('Codec', 'H.264')).toBeChecked()
    expect(screen.getByText('Plays everywhere.')).toBeInTheDocument()
    await user.click(option('Frame rate', '30'))
    await user.click(option('Codec', 'VP9'))
    expect(screen.getByText('Video re-encoded to VP9 at 30 fps, audio to Opus at 128 kbps.')).toBeInTheDocument()
    await user.click(compress())
    expect(client.jobs[0].plan).toMatchObject({ container: 'webm', video: { codec: 'vp9', frameRate: 30 } })
  })

  it('asks again which codecs work at the chosen size, and disables the rest', async () => {
    // This browser's H.264 encoder manages 1080p but not 720p.
    const { client, user } = await openOnCompress(fakeInfo(), (size) => ({
      ...ALL_CAPABLE.encodeVideo,
      avc: size.height !== 720,
    }))
    await user.click(screen.getByRole('button', { name: 'More options' }))
    await user.click(option('Resolution', '720p'))
    await waitFor(() => expect(option('Codec', 'H.264')).toBeDisabled())
    expect(screen.getByText('Not available in this browser: H.264.')).toBeInTheDocument()
    expect(option('Codec', 'HEVC')).toBeChecked()
    await user.click(compress())
    expect(client.jobs[0].plan.video).toMatchObject({ codec: 'hevc', width: 1280, height: 720 })
  })

  it('makes audio smaller or removes it', async () => {
    const { client, user } = await openOnCompress()
    await user.click(option('Audio', 'Smaller'))
    expect(screen.getByText('Video re-encoded to H.264, audio to AAC at 96 kbps.')).toBeInTheDocument()
    await user.click(option('Audio', 'Remove'))
    await user.click(compress())
    expect(client.jobs[0].plan.keep).toEqual([1])
  })

  it('has no audio choice for a silent video', async () => {
    await openOnCompress(fakeInfo({ tracks: [fakeVideoTrack()] }))
    expect(screen.queryByRole('radiogroup', { name: 'Audio' })).not.toBeInTheDocument()
  })

  it('flags a result more than 5% over the target, and one larger than the source', async () => {
    const { client, user } = await openOnCompress(fakeInfo({ size: 10_000_000, duration: 20 }), undefined, 10_000_000)
    await user.click(option('Aim', 'Target size'))
    await user.click(screen.getByRole('button', { name: '8 MB' }))
    await user.click(compress())
    await act(async () => client.jobs[0].finish({ size: 8_800_000, blob: new Blob(['x']) }))
    const strip = screen.getByRole('region', { name: 'Exports' })
    expect(within(strip).getByText('10% over the 8 MB target.')).toBeInTheDocument()
    expect(within(strip).queryByText(/larger than the original/)).not.toBeInTheDocument()

    await user.click(option('Aim', 'Quality'))
    await user.click(compress())
    await act(async () => client.jobs[1].finish({ size: 10_400_000, blob: new Blob(['x']) }))
    expect(within(strip).getByText('4% larger than the original. Try a lower quality.')).toBeInTheDocument()
  })

  it('says nothing more of a result that landed near the target', async () => {
    const { client, user } = await openOnCompress(fakeInfo({ size: 10_000_000, duration: 20 }))
    await user.click(option('Aim', 'Target size'))
    await user.click(screen.getByRole('button', { name: '8 MB' }))
    await user.click(compress())
    await act(async () => client.jobs[0].finish({ size: 8_300_000, blob: new Blob(['x']) }))
    expect(screen.queryByText(/over the .* target/)).not.toBeInTheDocument()
  })
})
