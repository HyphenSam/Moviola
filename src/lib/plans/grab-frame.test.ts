import { describe, expect, it } from 'vitest'
import { fakeInfo, fakeVideoTrack } from '@/lib/testing'
import { planGrabFrame } from './grab-frame'

describe('planGrabFrame', () => {
  it('saves the frame at the playhead as a PNG at the video’s full size, named with the time', () => {
    const planned = planGrabFrame(fakeInfo(), 83.456, 'png')
    expect(planned.plan).toEqual({
      kind: 'frame',
      name: 'holiday frame 0-01-23.456.png',
      mimeType: 'image/png',
      lossless: false,
      time: 83.456,
    })
    expect(planned.caption).toBe('The full 1920 × 1080 frame.')
  })

  it('writes a JPEG with the .jpg extension', () => {
    expect(planGrabFrame(fakeInfo(), 2, 'jpeg').plan).toMatchObject({
      name: 'holiday frame 0-00-02.000.jpg',
      mimeType: 'image/jpeg',
    })
  })

  it('names hours in full, never with a colon', () => {
    expect(planGrabFrame(fakeInfo({ duration: 7200 }), 3723.5, 'png').plan?.name).toBe('holiday frame 1-02-03.500.png')
  })

  it('asks for the source’s own timestamp, so a late-starting MPEG-TS gives the frame the user sees', () => {
    const planned = planGrabFrame(fakeInfo({ name: 'match.ts', container: 'mpegts', start: 1.4 }), 10, 'png')
    expect(planned.plan).toMatchObject({ name: 'match frame 0-00-10.000.png', time: 11.4 })
  })

  it('keeps to the file', () => {
    expect(planGrabFrame(fakeInfo(), -1, 'png').plan?.time).toBe(0)
    expect(planGrabFrame(fakeInfo(), 99, 'png').plan?.time).toBe(83.5)
  })

  it('gives the size after rotation, which is what it saves', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ width: 1080, height: 1920, rotation: 90 })] })
    expect(planGrabFrame(info, 0, 'png').caption).toBe('The full 1080 × 1920 frame.')
  })

  it('says HDR is converted to SDR', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', colour: { transfer: 'pq', hdr: true } })] })
    expect(planGrabFrame(info, 0, 'png').caption).toBe('The full 1920 × 1080 frame. HDR frames are converted to SDR.')
  })

  it('can’t grab a frame this browser can’t decode', () => {
    const info = fakeInfo({ tracks: [fakeVideoTrack({ codec: 'hevc', canDecode: false })] })
    expect(planGrabFrame(info, 0, 'png')).toEqual({
      problems: ['This browser can’t decode HEVC, so it can’t show a frame.'],
    })
  })
})
