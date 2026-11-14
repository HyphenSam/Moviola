// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import type { MediaInfo } from './lib/info'
import type { WorkerCapabilities } from './lib/protocol'
import { fakeAudioInfo, fakeAudioTrack, fakeClient, fakeFrames, fakeInfo, fakeVideoTrack } from './lib/testing'

const video = (name = 'holiday.mp4') => new File([new Uint8Array(16)], name, { type: 'video/mp4' })

/** Opens `info` (a 12.3 MB H.264 + AAC MP4 unless told otherwise) on Extract audio, in a browser
 * that can encode everything unless told otherwise. */
async function openOnExtract(info: MediaInfo = fakeInfo(), capabilities?: WorkerCapabilities) {
  const client = fakeClient((file) => ({ ...info, name: file.name }), capabilities)
  const user = userEvent.setup()
  render(<App webCodecs client={client} frames={fakeFrames()} />)
  await user.upload(screen.getByLabelText('Choose file'), video(info.name))
  await screen.findByRole('region', { name: 'Open file' })
  await user.click(
    within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: 'Extract audio' }),
  )
  return { client, user }
}

const extract = () => screen.getByRole('button', { name: 'Extract' })
const formats = () => screen.getByRole('radiogroup', { name: 'Format' })
const format = (name: string) => within(formats()).getByRole('radio', { name })
const extractTool = () =>
  within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: 'Extract audio' })
const exportsStrip = () => screen.getByRole('region', { name: 'Exports' })

type Picker = (options: { suggestedName: string; types: unknown[] }) => Promise<FileSystemFileHandle>
const withPicker = (picker: Picker) =>
  ((window as unknown as { showSaveFilePicker?: Picker }).showSaveFilePicker = vi.fn(picker))

describe('Extract audio', () => {
  afterEach(() => {
    delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker
    vi.restoreAllMocks()
  })

  it('says it copies the AAC into .m4a without loss, labelled Lossless', async () => {
    await openOnExtract()
    expect(screen.getByRole('heading', { name: 'Extract audio' })).toBeInTheDocument()
    expect(screen.getByText('AAC, copied as is into .m4a. No quality is lost.')).toBeInTheDocument()
    expect(screen.getByText('Lossless')).toBeInTheDocument()
    expect(extract()).toBeEnabled()
    // One audio track: nothing to choose.
    expect(screen.queryByRole('radiogroup', { name: 'Audio track' })).not.toBeInTheDocument()
  })

  it('lets the user pick which audio track, the default first, and names the result after it', async () => {
    const info = fakeInfo({
      name: 'film.mkv',
      container: 'mkv',
      tracks: [
        fakeVideoTrack(),
        fakeAudioTrack({ id: 2, language: 'eng' }),
        fakeAudioTrack({ id: 3, language: 'fra', isDefault: false, codec: 'ac3', codecString: 'ac-3', channels: 6 }),
      ],
    })
    const { client, user } = await openOnExtract(info)
    const tracks = screen.getByRole('radiogroup', { name: 'Audio track' })
    expect(within(tracks).getByRole('radio', { name: 'English · AAC · stereo' })).toBeChecked()
    await user.click(within(tracks).getByRole('radio', { name: 'French · AC-3 · 5.1' }))
    expect(screen.getByText('AC-3, copied as is into .mka. No quality is lost.')).toBeInTheDocument()

    await user.click(extract())
    expect(client.jobs[0].plan).toMatchObject({ name: 'film (track 2).mka', keep: [3] })
  })

  it('shows what stops a job instead of running it', async () => {
    await openOnExtract(fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: null, codecString: null })] }))
    expect(
      screen.getByText('Moviola can’t tell which codec this audio track uses, so it can’t copy it.'),
    ).toBeInTheDocument()
    expect(extract()).toBeDisabled()
  })

  describe('formats', () => {
    it('offers Original, MP3, WAV and FLAC, Original first', async () => {
      await openOnExtract()
      expect(
        within(formats())
          .getAllByRole('radio')
          .map((r) => r.textContent),
      ).toEqual(['Original', 'MP3', 'WAV', 'FLAC'])
      expect(format('Original')).toBeChecked()
      expect(screen.queryByRole('radiogroup', { name: 'Bitrate' })).not.toBeInTheDocument()
    })

    it('re-encodes to MP3 at the chosen bitrate, 192 kbps unless changed', async () => {
      const { client, user } = await openOnExtract()
      await user.click(format('MP3'))
      const bitrate = screen.getByRole('radiogroup', { name: 'Bitrate' })
      expect(within(bitrate).getByRole('radio', { name: '192 kbps' })).toBeChecked()
      expect(screen.getByText('Re-encodes')).toBeInTheDocument()
      expect(screen.getByText('AAC re-encoded to MP3 at 192 kbps.')).toBeInTheDocument()

      await user.click(within(bitrate).getByRole('radio', { name: '320 kbps' }))
      await user.click(extract())
      expect(client.jobs[0].plan).toMatchObject({ name: 'holiday.mp3', audio: { codec: 'mp3', bitrate: 320_000 } })
    })

    it('hints that Original already keeps an MP3 without loss', async () => {
      const { user } = await openOnExtract(
        fakeInfo({ tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'mp3', codecString: 'mp3' })] }),
      )
      await user.click(format('MP3'))
      expect(screen.getByText('Already MP3: Original keeps it without loss.')).toBeInTheDocument()
    })

    it('decodes to WAV at 16 or 24 bits, saying it can’t restore what AAC lost', async () => {
      const { client, user } = await openOnExtract()
      await user.click(format('WAV'))
      const depth = screen.getByRole('radiogroup', { name: 'Bit depth' })
      expect(within(depth).getByRole('radio', { name: '16-bit' })).toBeChecked()
      expect(screen.getByText('Decodes to WAV')).toBeInTheDocument()
      expect(screen.queryByText('Lossless')).not.toBeInTheDocument()
      expect(
        screen.getByText('WAV is uncompressed, but it can’t restore what the original codec already lost.'),
      ).toBeInTheDocument()

      await user.click(within(depth).getByRole('radio', { name: '24-bit' }))
      await user.click(extract())
      expect(client.jobs[0].plan).toMatchObject({ name: 'holiday.wav', audio: { codec: 'pcm-s24' } })
    })

    it('calls FLAC from PCM lossless', async () => {
      const { user } = await openOnExtract(
        fakeInfo({
          tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'pcm-s16', codecString: 'pcm-s16', bitDepth: 16 })],
        }),
      )
      await user.click(format('FLAC'))
      expect(screen.getByText('Lossless')).toBeInTheDocument()
      expect(screen.getByText('PCM 16-bit, compressed into 16-bit FLAC. No quality is lost.')).toBeInTheDocument()
    })

    it('rules out converting a track this browser can’t decode, saying Original still works', async () => {
      await openOnExtract(
        fakeInfo({
          name: 'h264-ac3.mkv',
          tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', codecString: 'ac-3', canDecode: false })],
        }),
      )
      for (const name of ['MP3', 'WAV', 'FLAC']) expect(format(name)).toBeDisabled()
      expect(format('Original')).toBeEnabled()
      expect(screen.getByText('This browser can’t decode AC-3. Original still works.')).toBeInTheDocument()
      expect(extract()).toBeEnabled()
    })

    it('rules out MP3 and FLAC where there’s no encoder for them', async () => {
      await openOnExtract(fakeInfo(), {
        encodeVideo: {},
        encodeAudio: { aac: true, opus: true, mp3: false, flac: false },
        encodeWebp: true,
      })
      expect(await screen.findByText('This browser can’t encode MP3.')).toBeInTheDocument()
      expect(screen.getByText('This browser can’t encode FLAC.')).toBeInTheDocument()
      expect(format('MP3')).toBeDisabled()
      expect(format('FLAC')).toBeDisabled()
      expect(format('WAV')).toBeEnabled()
    })

    it('keeps the chosen format for the next file, and falls back to Original where it can’t be used', async () => {
      const ac3 = fakeInfo({
        tracks: [fakeVideoTrack(), fakeAudioTrack({ codec: 'ac3', codecString: 'ac-3', canDecode: false })],
      })
      const client = fakeClient((file) =>
        file.name === 'other.mkv' ? { ...ac3, name: file.name } : fakeInfo({ name: file.name }),
      )
      const user = userEvent.setup()
      render(<App webCodecs client={client} frames={fakeFrames()} />)
      await user.upload(screen.getByLabelText('Choose file'), video())
      await screen.findByRole('region', { name: 'Open file' })
      await user.click(extractTool())
      await user.click(format('WAV'))

      await user.upload(screen.getByLabelText('Choose file'), video('another.mp4'))
      await waitFor(() => expect(client.probed).toHaveLength(2))
      await user.click(extractTool())
      expect(format('WAV')).toBeChecked()

      await user.upload(screen.getByLabelText('Choose file'), video('other.mkv'))
      await waitFor(() => expect(client.probed).toHaveLength(3))
      await user.click(extractTool())
      expect(format('Original')).toBeChecked()
      expect(extract()).toBeEnabled()
    })
  })

  it('calls it Convert for an audio file', async () => {
    const client = fakeClient(() => fakeAudioInfo())
    const user = userEvent.setup()
    render(<App webCodecs client={client} frames={fakeFrames()} />)
    await user.upload(screen.getByLabelText('Choose file'), new File(['x'], 'song.m4a'))
    expect(await screen.findByRole('heading', { name: 'Convert audio' })).toBeInTheDocument()
    await user.click(format('MP3'))
    await user.click(screen.getByRole('button', { name: 'Convert' }))
    expect(screen.getByRole('progressbar', { name: 'Converting song.mp3' })).toBeInTheDocument()
  })

  describe('without a save dialog (Firefox, Safari)', () => {
    it('builds the result in memory, shows progress, then offers it to download', async () => {
      const { client, user } = await openOnExtract()
      await user.click(extract())
      const [job] = client.jobs
      expect(job.target).toEqual({ type: 'memory' })
      expect(job.plan).toMatchObject({ name: 'holiday.m4a', container: 'mp4' })

      const bar = screen.getByRole('progressbar', { name: 'Extracting holiday.m4a' })
      // The progress replaces the action.
      expect(screen.queryByRole('button', { name: 'Extract' })).not.toBeInTheDocument()
      act(() => job.progress(0.42))
      expect(bar).toHaveAttribute('aria-valuenow', '42')
      expect(screen.getByText('42%')).toBeInTheDocument()

      // The source file is 16 bytes.
      await act(async () => job.finish({ size: 4, blob: new Blob(['x'], { type: 'audio/mp4' }) }))
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      const card = within(exportsStrip()).getByRole('listitem')
      expect(card).toHaveTextContent('holiday.m4a')
      expect(card).toHaveTextContent('4 bytes · −75%')
      const download = within(card).getByRole('link', { name: 'Download' })
      expect(download).toHaveAttribute('download', 'holiday.m4a')
      expect(download.getAttribute('href')).toMatch(/^blob:/)
      expect(extract()).toBeEnabled()
    })

    it('numbers a second result with the same name, newest first, and frees one when removed', async () => {
      const revoke = vi.spyOn(URL, 'revokeObjectURL')
      const { client, user } = await openOnExtract()
      for (let i = 0; i < 2; i++) {
        await user.click(extract())
        await act(async () => client.jobs[i].finish({ size: 10, blob: new Blob(['x']) }))
      }
      const names = () =>
        within(exportsStrip())
          .getAllByRole('listitem')
          .map((li) => li.querySelector('a')?.download)
      expect(names()).toEqual(['holiday (2).m4a', 'holiday.m4a'])

      await user.click(screen.getByRole('button', { name: 'Remove holiday (2).m4a' }))
      expect(names()).toEqual(['holiday.m4a'])
      expect(revoke).toHaveBeenCalledTimes(1)
    })

    it('warns that a result from a source over 2 GB is held in memory', async () => {
      await openOnExtract(fakeInfo({ size: 3_000_000_000 }))
      expect(screen.getByText(/held in memory until you download it/)).toBeInTheDocument()
    })
  })

  describe('with a save dialog (Chrome, Edge)', () => {
    it('asks where to save inside the click, then streams there and says Saved', async () => {
      const handle = { name: 'my audio.m4a' } as FileSystemFileHandle
      const picker = withPicker(async () => handle)
      const { client, user } = await openOnExtract()
      expect(screen.queryByText(/held in memory/)).not.toBeInTheDocument()

      await user.click(extract())
      expect(picker).toHaveBeenCalledWith({
        suggestedName: 'holiday.m4a',
        types: [{ description: 'Audio', accept: { 'audio/mp4': ['.m4a'] } }],
      })
      await waitFor(() => expect(client.jobs).toHaveLength(1))
      expect(client.jobs[0].target).toEqual({ type: 'file', handle })
      expect(screen.getByRole('progressbar', { name: 'Extracting my audio.m4a' })).toBeInTheDocument()

      await act(async () => client.jobs[0].finish({ size: 2000, blob: null }))
      const card = within(exportsStrip()).getByRole('listitem')
      expect(card).toHaveTextContent('my audio.m4a')
      expect(card).toHaveTextContent('Saved')
      expect(within(card).queryByRole('link')).not.toBeInTheDocument()
    })

    it('does nothing at all when the dialog is cancelled', async () => {
      withPicker(async () => {
        throw new DOMException('The user aborted a request.', 'AbortError')
      })
      const { client, user } = await openOnExtract()
      await user.click(extract())
      expect(client.jobs).toHaveLength(0)
      expect(screen.queryByRole('region', { name: 'Exports' })).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      expect(extract()).toBeEnabled()
    })
  })

  it('cancels a running job: no export, and the action is back', async () => {
    const { client, user } = await openOnExtract()
    await user.click(extract())
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(client.jobs[0].cancelled).toBe(true)
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Exports' })).not.toBeInTheDocument()
    expect(extract()).toBeEnabled()
  })

  it('shows a failed job as an export with the reason', async () => {
    const { client, user } = await openOnExtract()
    await user.click(extract())
    await act(async () => client.jobs[0].fail('Something went wrong: disk full.'))
    const card = within(exportsStrip()).getByRole('listitem')
    expect(card).toHaveTextContent('holiday.m4a')
    expect(card).toHaveTextContent('Something went wrong: disk full.')
    expect(within(card).queryByRole('link')).not.toBeInTheDocument()
  })

  it('asks the browser to confirm leaving while a job runs, and not otherwise', async () => {
    const { client, user } = await openOnExtract()
    const leave = () => {
      const event = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(event)
      return event.defaultPrevented
    }
    expect(leave()).toBe(false)
    await user.click(extract())
    expect(leave()).toBe(true)
    await act(async () => client.jobs[0].finish({ size: 1, blob: new Blob(['x']) }))
    expect(leave()).toBe(false)
  })

  it('asks before opening another file while a job runs, and cancels the job if told to', async () => {
    const { client, user } = await openOnExtract()
    await user.click(extract())

    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false)
    await user.upload(screen.getByLabelText('Choose file'), video('other.mp4'))
    expect(confirm).toHaveBeenCalledWith('Cancel the running job and open the new file?')
    expect(client.probed.map((f) => f.name)).toEqual(['holiday.mp4'])
    expect(client.jobs[0].cancelled).toBe(false)

    confirm.mockReturnValueOnce(true)
    await user.upload(screen.getByLabelText('Choose file'), video('other.mp4'))
    expect(client.jobs[0].cancelled).toBe(true)
    expect(client.probed.map((f) => f.name)).toEqual(['holiday.mp4', 'other.mp4'])
  })
})
