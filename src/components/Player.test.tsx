// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '@/lib/info'
import { fakeAudioInfo, fakeFrames, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { Player } from './Player'

function setup(info: MediaInfo = fakeInfo()) {
  const frames = fakeFrames()
  const file = new File(['x'], info.name)
  const user = userEvent.setup()
  const view = render(<Player file={file} info={info} frames={frames} />)
  const media = () => view.container.querySelector<HTMLMediaElement>('video, audio')
  return { frames, file, user, media, view }
}

const position = () => screen.getByLabelText('Position')

describe('Player', () => {
  it('plays the file natively in a video element', async () => {
    const { media, user } = setup()
    const video = media()!
    expect(video.tagName).toBe('VIDEO')
    expect(video.getAttribute('src')).toMatch(/^blob:/)
    expect(screen.queryByText('Preview without sound')).not.toBeInTheDocument()
    expect(position()).toHaveTextContent('0:00.000 / 1:23.500')

    await user.click(screen.getByRole('button', { name: 'Play' }))
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('shows the position as the video moves', () => {
    const { media } = setup()
    act(() => {
      media()!.currentTime = 12.5
      fireEvent(media()!, new Event('timeupdate'))
    })
    expect(position()).toHaveTextContent('0:12.500 / 1:23.500')
  })

  it('steps a frame at the file’s frame rate', async () => {
    const { media, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Next frame' }))
    expect(media()!.currentTime).toBeCloseTo(0.04)
    await user.click(screen.getByRole('button', { name: 'Previous frame' }))
    expect(media()!.currentTime).toBeCloseTo(0)
  })

  it('mutes and sets the volume', async () => {
    const { media, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    expect(media()!.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.5' } })
    expect(media()!.volume).toBe(0.5)
  })

  it('answers the keyboard: Space, arrows, Shift+arrows, Home and End', async () => {
    const { media, user } = setup()
    await user.keyboard(' ')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    await user.keyboard(' ')
    await user.keyboard('{ArrowRight}')
    expect(media()!.currentTime).toBe(1)
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}')
    expect(media()!.currentTime).toBe(6)
    await user.keyboard('{ArrowLeft}')
    expect(media()!.currentTime).toBe(5)
    await user.keyboard('{End}')
    expect(media()!.currentTime).toBe(83.5)
    await user.keyboard('{Home}')
    expect(media()!.currentTime).toBe(0)
    await user.keyboard('{ArrowLeft}')
    expect(media()!.currentTime).toBe(0)
  })

  it('falls back to decoded frames without sound when the browser can’t play the file', async () => {
    const { media, frames, file } = setup(fakeInfo({ name: 'film.mkv', container: 'mkv' }))
    fireEvent(media()!, new Event('error'))
    expect(await screen.findByText('Preview without sound')).toBeInTheDocument()
    expect(media()).toBeNull()
    await waitFor(() => expect(frames.opened).toEqual([file]))
    expect(screen.queryByRole('button', { name: 'Mute' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
  })

  it('falls back when the browser plays the sound but shows no picture', async () => {
    const { media } = setup()
    fireEvent(media()!, new Event('loadedmetadata'))
    expect(await screen.findByText('Preview without sound')).toBeInTheDocument()
  })

  it('plays decoded frames in the fallback and shows where it got to', async () => {
    const { media, user } = setup()
    fireEvent(media()!, new Event('error'))
    await screen.findByText('Preview without sound')
    await user.click(screen.getByRole('button', { name: 'Next frame' }))
    expect(position()).toHaveTextContent('0:00.040 / 1:23.500')
    await user.click(screen.getByRole('button', { name: 'Play' }))
    // The fake has three frames from the playhead; playing stops after the last.
    await waitFor(() => expect(position()).toHaveTextContent('0:00.120 / 1:23.500'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument())
  })

  it('says when this browser can’t show the video at all', async () => {
    const { media } = setup(fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] }))
    fireEvent(media()!, new Event('error'))
    expect(
      await screen.findByText('This browser can’t show this video, but copying tools still work.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
  })

  it('shows an audio file as its name and length with an audio element', () => {
    const { media } = setup(fakeAudioInfo())
    expect(media()!.tagName).toBe('AUDIO')
    expect(screen.getByRole('heading', { name: 'song.m4a' })).toBeInTheDocument()
    expect(screen.getByText('1:24')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Next frame' })).not.toBeInTheDocument()
  })

  it('says when this browser can’t play an audio file', async () => {
    const { media } = setup(fakeAudioInfo())
    fireEvent(media()!, new Event('error'))
    expect(await screen.findByText('This browser can’t play this audio, but the tools still work.')).toBeInTheDocument()
  })
})
