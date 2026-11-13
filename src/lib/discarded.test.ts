import { describe, expect, it } from 'vitest'
import { discardedSentence } from './discarded'

describe('discardedSentence', () => {
  it('says which codec a container can’t take without re-encoding', () => {
    expect(discardedSentence({ kind: 'video', codec: 'avc', reason: 'cannot_copy', container: 'webm' })).toBe(
      'WebM can’t hold this H.264 video without re-encoding it.',
    )
  })

  it('says when the codec is unknown', () => {
    expect(discardedSentence({ kind: 'audio', codec: null, reason: 'unknown_source_codec', container: 'mp4' })).toBe(
      'Moviola can’t tell which codec this audio track uses, so it can’t copy it.',
    )
  })

  it('says when the browser can’t decode or encode', () => {
    expect(
      discardedSentence({ kind: 'audio', codec: 'ac3', reason: 'undecodable_source_codec', container: 'mp3' }),
    ).toBe('This browser can’t decode AC-3 audio.')
    expect(
      discardedSentence({ kind: 'video', codec: 'hevc', reason: 'no_encodable_target_codec', container: 'webm' }),
    ).toBe('This browser can’t encode any video codec that WebM holds.')
  })

  it('says when the container has no room for the track', () => {
    for (const reason of ['max_track_count_reached', 'max_track_count_of_type_reached'] as const) {
      expect(discardedSentence({ kind: 'audio', codec: 'mp3', reason, container: 'mp3' })).toBe(
        'MP3 can’t hold another audio track.',
      )
    }
  })

  it('says nothing about tracks the plan left out on purpose', () => {
    expect(discardedSentence({ kind: 'video', codec: 'avc', reason: 'discarded_by_user', container: 'mp4' })).toBeNull()
  })
})
