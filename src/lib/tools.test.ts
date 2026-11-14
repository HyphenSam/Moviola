import { describe, expect, it } from 'vitest'
import { fakeAudioInfo, fakeInfo, fakeVideoTrack } from './testing'
import { defaultTool, toolStates } from './tools'

const reasons = (states: ReturnType<typeof toolStates>) =>
  Object.fromEntries(states.filter((s) => s.reason).map((s) => [s.id, s.reason]))

describe('toolStates', () => {
  it('offers every tool for a video with audio', () => {
    const states = toolStates(fakeInfo())
    expect(states.map((s) => s.label)).toEqual([
      'Media info',
      'Extract audio',
      'Trim',
      'Change container',
      'Remove audio',
      'Compress',
      'Grab frame',
      'Make animation',
    ])
    expect(reasons(states)).toEqual({})
  })

  it('dims the video-only tools for an audio file and calls Extract audio "Convert audio"', () => {
    const states = toolStates(fakeAudioInfo())
    expect(states.find((s) => s.id === 'extract-audio')!.label).toBe('Convert audio')
    const needsVideo = 'This file has no video.'
    expect(reasons(states)).toEqual({
      'remove-audio': needsVideo,
      compress: needsVideo,
      frame: needsVideo,
      animation: needsVideo,
      container: needsVideo,
    })
  })

  it('dims Extract audio for a video with no audio track', () => {
    expect(reasons(toolStates(fakeInfo({ tracks: [fakeVideoTrack()] })))).toEqual({
      'extract-audio': 'This file has no audio track.',
      'remove-audio': 'This file has no audio track.',
    })
  })

  it('offers nothing before a file is open', () => {
    expect(toolStates(null).every((s) => s.reason === null)).toBe(true)
  })
})

describe('defaultTool', () => {
  it('opens Media info for a video and Extract audio for an audio file', () => {
    expect(defaultTool(fakeInfo())).toBe('info')
    expect(defaultTool(fakeAudioInfo())).toBe('extract-audio')
  })
})
