// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlayer } from '@/hooks/usePlayer'
import { videoTrack, type MediaInfo } from '@/lib/info'
import type { OpenFrames } from '@/media/frames'
import { fakeAudioInfo, fakeFrames, fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { Player } from './Player'

/** The player state lives above the Player (App shares the playhead with the tools), as here. */
function Harness(props: {
  file: File
  info: MediaInfo
  frames: OpenFrames
  onMark: (end: 'in' | 'out', time: number) => void
}) {
  const player = usePlayer(props.file, props.info.duration, videoTrack(props.info)?.frameRate ?? null)
  return <Player {...props} player={player} />
}

/** The element's clock as a browser sets it when the first frame is in: where it stands (Chrome: the
 * file's first timestamp; Firefox: 0), how long it says the file is, and what it has buffered. */
function load(el: HTMLMediaElement, clock: { at?: number; duration?: number; buffered?: [number, number] } = {}) {
  const { at = 0, duration = NaN, buffered } = clock
  const ranges = buffered ? [buffered] : []
  Object.defineProperty(el, 'duration', { value: duration, configurable: true })
  Object.defineProperty(el, 'buffered', {
    value: { length: ranges.length, start: (i: number) => ranges[i][0], end: (i: number) => ranges[i][1] },
    configurable: true,
  })
  act(() => {
    el.currentTime = at
    fireEvent(el, new Event('loadeddata'))
  })
}

/** Renders the player; the file loads with the element's clock at 0, as for most files, unless
 * `clock` is null (still loading) or says otherwise. */
function setup(info: MediaInfo = fakeInfo(), clock: Parameters<typeof load>[1] | null = {}) {
  const frames = fakeFrames()
  const file = new File(['x'], info.name)
  const user = userEvent.setup()
  const onMark = vi.fn()
  const view = render(<Harness file={file} info={info} frames={frames} onMark={onMark} />)
  const media = () => view.container.querySelector<HTMLMediaElement>('video, audio')
  if (clock) load(media()!, clock)
  return { frames, file, user, media, view, onMark }
}

const tick = (el: HTMLMediaElement, at: number) =>
  act(() => {
    el.currentTime = at
    fireEvent(el, new Event('timeupdate'))
  })

const position = () => screen.getByLabelText('Position')

describe('Player', () => {
  afterEach(() => localStorage.clear())

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

  it('keeps the picture out of the tab order: the transport is the way in from the keyboard', async () => {
    // Firefox makes a video without controls a tab stop with nothing to say.
    const { media } = setup()
    expect(media()).toHaveAttribute('tabindex', '-1')
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
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.25' } })
    expect(media()!.volume).toBe(0.25)
  })

  it('starts at half volume', () => {
    const { media } = setup()
    expect(media()!.volume).toBe(0.5)
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.5')
  })

  it('remembers the volume for the next file and the next visit', () => {
    const first = setup()
    fireEvent.change(screen.getByRole('slider', { name: 'Volume' }), { target: { value: '0.8' } })
    first.view.unmount()
    const { media } = setup()
    expect(media()!.volume).toBe(0.8)
    expect(screen.getByRole('slider', { name: 'Volume' })).toHaveValue('0.8')
  })

  it('remembers mute for the next file and the next visit', async () => {
    const first = setup()
    expect(first.media()!.muted).toBe(false)
    await first.user.click(screen.getByRole('button', { name: 'Mute' }))
    first.view.unmount()
    const { media } = setup()
    expect(media()!.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Unmute' })).toBeInTheDocument()
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

  it('steps a frame back and forward with comma and full stop, pausing first', async () => {
    const { media, user } = setup()
    await user.keyboard(' ')
    await user.keyboard('..')
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
    expect(media()!.currentTime).toBeCloseTo(0.08)
    await user.keyboard(',')
    expect(media()!.currentTime).toBeCloseTo(0.04)
  })

  it('marks the in and out points at the playhead with I and O', async () => {
    const { user, onMark } = setup()
    await user.keyboard('{ArrowRight}{ArrowRight}i')
    expect(onMark).toHaveBeenLastCalledWith('in', 2)
    await user.keyboard('{ArrowRight}o')
    expect(onMark).toHaveBeenLastCalledWith('out', 3)
  })

  it('still moves the playhead and marks the range when the video can’t be shown, for the copying tools', async () => {
    const { media, user, onMark } = setup(fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] }))
    fireEvent(media()!, new Event('error'))
    await screen.findByText('This browser can’t show this video, but copying tools still work.')
    await user.keyboard('{ArrowRight}o')
    expect(onMark).toHaveBeenLastCalledWith('out', 1)
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

  describe('a file whose first timestamp is 10 s in', () => {
    // As h264-aac-late.mp4 probes: the playhead's 0 is the file's 9.978 s.
    const late = () => fakeInfo({ start: 9.978, duration: 4.022 })

    it('counts from the playhead’s 0 where the browser’s clock runs on the file’s timestamps (Chrome)', async () => {
      const { media, user } = setup(late(), { at: 9.978, duration: 14 })
      expect(position()).toHaveTextContent('0:00.000 / 0:04.022')
      tick(media()!, 10.978)
      expect(position()).toHaveTextContent('0:01.000 / 0:04.022')
      await user.keyboard('{ArrowRight}')
      expect(media()!.currentTime).toBeCloseTo(11.978)
      await user.keyboard('{Home}')
      expect(media()!.currentTime).toBeCloseTo(9.978)
      await user.keyboard('{ArrowRight}i')
      expect(position()).toHaveTextContent('0:01.000 / 0:04.022')
    })

    it('leaves the clock alone where the browser already counts from the first timestamp (Firefox)', async () => {
      const { media, user } = setup(late(), { at: 0, duration: 4.022, buffered: [0.021, 4.03] })
      tick(media()!, 1)
      expect(position()).toHaveTextContent('0:01.000 / 0:04.022')
      await user.keyboard('{ArrowRight}')
      expect(media()!.currentTime).toBeCloseTo(2)
    })

    it('holds seeks asked for before the first frame is in until the clock is known', async () => {
      const { media, user } = setup(late(), null)
      await user.keyboard('{ArrowRight}{ArrowRight}')
      expect(position()).toHaveTextContent('0:02.000 / 0:04.022')
      load(media()!, { at: 9.978, duration: 14 })
      expect(media()!.currentTime).toBeCloseTo(11.978)
      expect(position()).toHaveTextContent('0:02.000 / 0:04.022')
    })

    it('never reports a time outside the file, and stops at its end though the browser plays on', async () => {
      // Firefox says an MKV or WebM that starts late is as long as its last timestamp (14 s).
      const { media, user } = setup(late(), { at: 0, duration: 14, buffered: [0, 4.02] })
      await user.click(screen.getByRole('button', { name: 'Play' }))
      tick(media()!, 4.5)
      expect(position()).toHaveTextContent('0:04.022 / 0:04.022')
      expect(media()!.paused).toBe(true)
      expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument()
      // Playing again starts over, as at a real end.
      await user.click(screen.getByRole('button', { name: 'Play' }))
      expect(media()!.currentTime).toBe(0)
    })

    it('never reports a time before 0', () => {
      const { media } = setup(late(), { at: 9.978, duration: 14 })
      tick(media()!, 9.9)
      expect(position()).toHaveTextContent('0:00.000 / 0:04.022')
    })

    it('falls back to decoded frames when the browser’s picture starts well after its clock’s 0', async () => {
      // Firefox plays h264-aac-late.mp4's picture 0.56 s late against its own clock, which no single
      // offset mends (its sound isn't late); what it has buffered starts there too.
      setup(late(), { at: 0, duration: 4.022, buffered: [0.573, 3.814] })
      expect(await screen.findByText('Preview without sound')).toBeInTheDocument()
    })

    it('says once when the browser’s idea of the length differs from the file’s by more than a frame', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const { media } = setup(late(), { at: 0, duration: 14, buffered: [0, 4.02] })
      act(() => void fireEvent(media()!, new Event('durationchange')))
      expect(warn).toHaveBeenCalledOnce()
      expect(warn.mock.calls[0][0]).toMatch(/14\.000 s.*4\.022 s/)
      warn.mockRestore()
    })

    it('says nothing when the lengths agree to within a frame', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      // vp9-opus-late.webm in Chrome: 14.028 s on a clock from 10 s, against 4.007 s probed.
      setup(fakeInfo({ start: 10, duration: 4.007 }), { at: 10, duration: 14.028 })
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  it('says when this browser can’t play an audio file', async () => {
    const { media } = setup(fakeAudioInfo())
    fireEvent(media()!, new Event('error'))
    expect(await screen.findByText('This browser can’t play this audio, but the tools still work.')).toBeInTheDocument()
  })
})
