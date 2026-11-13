import type { MediaCodec } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { CONTAINER_CODECS } from '@/media/formats'
import { losslessAudioContainer } from './containers'

const lossless = (codec: MediaCodec) => losslessAudioContainer(codec, CONTAINER_CODECS)

// SPEC.md 6.2's table, row by row, against Mediabunny's own lists of what each container holds.
describe('losslessAudioContainer', () => {
  it('puts AAC in an audio-only MP4, .m4a', () => {
    expect(lossless('aac')).toEqual({ container: 'mp4', extension: 'm4a', mimeType: 'audio/mp4' })
  })

  it('puts Opus in Ogg, .opus', () => {
    expect(lossless('opus')).toEqual({ container: 'ogg', extension: 'opus', mimeType: 'audio/ogg' })
  })

  it('puts Vorbis in Ogg, .ogg', () => {
    expect(lossless('vorbis')).toEqual({ container: 'ogg', extension: 'ogg', mimeType: 'audio/ogg' })
  })

  it('puts MP3 in MP3', () => {
    expect(lossless('mp3')).toEqual({ container: 'mp3', extension: 'mp3', mimeType: 'audio/mpeg' })
  })

  it('puts FLAC in FLAC', () => {
    expect(lossless('flac')).toEqual({ container: 'flac', extension: 'flac', mimeType: 'audio/flac' })
  })

  it('puts the PCM that WAV holds, μ-law and A-law in WAV', () => {
    for (const codec of ['pcm-u8', 'pcm-s16', 'pcm-s24', 'pcm-s32', 'pcm-f32', 'pcm-f64', 'ulaw', 'alaw'] as const) {
      expect(lossless(codec), codec).toEqual({ container: 'wav', extension: 'wav', mimeType: 'audio/wav' })
    }
  })

  it('puts AC-3, E-AC-3, DTS, TrueHD and big-endian PCM in Matroska audio, .mka', () => {
    for (const codec of ['ac3', 'eac3', 'dts', 'truehd', 'pcm-s16be', 'pcm-s24be', 'pcm-s32be'] as const) {
      expect(lossless(codec), codec).toEqual({ container: 'mkv', extension: 'mka', mimeType: 'audio/x-matroska' })
    }
  })

  it('falls back to MOV for what Matroska can’t hold', () => {
    for (const codec of ['pcm-f32be', 'pcm-f64be', 'pcm-s8'] as const) {
      expect(lossless(codec), codec).toEqual({ container: 'mov', extension: 'mov', mimeType: 'video/quicktime' })
    }
  })

  it('has nowhere to put a codec no container holds', () => {
    expect(losslessAudioContainer('opus', { ...CONTAINER_CODECS, ogg: [], mkv: [], mov: [] })).toBeNull()
  })
})
