import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AudioTrack, MediaInfo, VideoTrack } from '@/lib/info'
import { CANT_OPEN, probe } from './probe'

const fixture = (name: string) => new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)

// Every video fixture is 4 s of 320×180 at 25 fps (scripts/fixtures.sh), with a tone in each audio channel.
const SMALL_H264 = { kind: 'video', codec: 'avc', codecString: 'avc1.64000c', width: 320, height: 180, rotation: 0 }

const video = (info: MediaInfo) => info.tracks.filter((t): t is VideoTrack => t.kind === 'video')
const audio = (info: MediaInfo) => info.tracks.filter((t): t is AudioTrack => t.kind === 'audio')

describe('probe', () => {
  it('reads an MP4 with H.264 and AAC', async () => {
    const info = await probe(fixture('h264-aac.mp4'))
    expect(info).toMatchObject({ name: 'h264-aac.mp4', container: 'mp4', duration: 4, tags: {} })
    expect(info.size).toBe(readFileSync(join(import.meta.dirname, '../../fixtures/h264-aac.mp4')).length)
    expect(info.mimeType).toMatch(/^video\/mp4; codecs="avc1\.64000c, ?mp4a\.40\.2"$/)
    expect(info.tracks).toHaveLength(2)
    const [v] = video(info)
    expect(v).toMatchObject({ ...SMALL_H264, id: 1, frameRate: 25, isDefault: true, language: null, name: null })
    expect(v.colour).toMatchObject({ hdr: false })
    expect(v.bitrate).toBeGreaterThan(100_000)
    expect(typeof v.canDecode).toBe('boolean')
    expect(audio(info)[0]).toMatchObject({
      kind: 'audio',
      id: 2,
      codec: 'aac',
      codecString: 'mp4a.40.2',
      sampleRate: 48000,
      channels: 2,
    })
    expect(audio(info)[0].bitrate).toBeGreaterThan(50_000)
  })

  it('reads both audio tracks of an MKV with their languages', async () => {
    const info = await probe(fixture('h264-aac-2audio.mkv'))
    expect(info.container).toBe('mkv')
    expect(info.duration).toBeCloseTo(4, 1)
    expect(video(info)).toHaveLength(1)
    expect(audio(info).map((t) => [t.id, t.codec, t.language, t.isDefault])).toEqual([
      [2, 'aac', 'eng', true],
      [3, 'aac', 'fra', false],
    ])
  })

  it('reads VP9 and Opus in WebM', async () => {
    const info = await probe(fixture('vp9-opus.webm'))
    expect(info.container).toBe('webm')
    expect(video(info)[0]).toMatchObject({ codec: 'vp9', width: 320, height: 180, frameRate: 25 })
    expect(audio(info)[0]).toMatchObject({ codec: 'opus', sampleRate: 48000, channels: 2 })
  })

  it('reads AC-3, FLAC and PCM audio', async () => {
    expect(audio(await probe(fixture('h264-ac3.mkv')))[0]).toMatchObject({ codec: 'ac3', codecString: 'ac-3' })
    expect(audio(await probe(fixture('h264-flac.mkv')))[0]).toMatchObject({ codec: 'flac', sampleRate: 48000 })
    const pcm = await probe(fixture('h264-pcm.mov'))
    expect(pcm.container).toBe('mov')
    expect(audio(pcm)[0]).toMatchObject({ codec: 'pcm-s16', sampleRate: 16000, channels: 1 })
  })

  it('opens MP3 in MOV but can’t name the codec', async () => {
    // ffmpeg's MOV muxer writes MP3 with the '.mp3' sample entry, which Mediabunny 1.65 doesn't read.
    // If this starts failing because the codec comes out as 'mp3', Mediabunny has learnt it: good.
    const info = await probe(fixture('h264-mp3.mov'))
    expect(info.container).toBe('mov')
    expect(audio(info)[0]).toMatchObject({ codec: null, codecString: null, sampleRate: 48000 })
  })

  it('counts an MPEG-TS file’s length from its first timestamp, not from zero', async () => {
    const info = await probe(fixture('h264-aac.ts'))
    expect(info.container).toBe('mpegts')
    // ffmpeg's 1.4 s muxing delay, less the AAC priming.
    expect(info.start).toBeCloseTo(1.459, 3)
    expect(info.duration).toBeCloseTo(4, 1)
    expect(info.tracks.map((t) => t.codec)).toEqual(['avc', 'aac'])
  })

  it('starts other files at zero', async () => {
    expect((await probe(fixture('h264-aac.mp4'))).start).toBe(0)
  })

  it('reads a video with no audio', async () => {
    const info = await probe(fixture('h264-only.mp4'))
    expect(info.tracks.map((t) => t.kind)).toEqual(['video'])
  })

  it('gives the display size after rotation', async () => {
    const [v] = video(await probe(fixture('rotated.mp4')))
    expect(v).toMatchObject({ width: 180, height: 320 })
    expect([90, 270]).toContain(v.rotation)
  })

  it('reads audio-only MP4', async () => {
    const info = await probe(fixture('aac.m4a'))
    expect(info.container).toBe('mp4')
    expect(info.duration).toBe(4)
    expect(info.tracks.map((t) => t.kind)).toEqual(['audio'])
  })

  it('reads a bare FLAC file’s full length and bitrate', async () => {
    // Mediabunny 1.65 gets both wrong (0.192 s) when they're measured at the same time.
    const info = await probe(fixture('flac.flac'))
    expect(info.container).toBe('flac')
    expect(info.duration).toBeCloseTo(4, 2)
    expect(audio(info)[0]).toMatchObject({ codec: 'flac', sampleRate: 48000, channels: 1 })
    expect(audio(info)[0].bitrate).toBeGreaterThan(100_000)
  })

  it.each([
    ['aac.m4a', [1]],
    ['h264-pcm.mov', [1]],
    ['h264-aac.mp4', [2]],
    ['h264-aac.ts', [2]],
    ['vp9-opus.webm', [2]],
    ['h264-flac.mkv', [2]],
    ['h264-aac-2audio.mkv', [2, 6]],
    ['h264-ac3.mkv', [6]],
    ['opus-51.webm', [6]],
    ['pcm-51.wav', [6]],
    ['pcm-71.wav', [8]],
  ])('reads how many channels %s’s audio has: %j', async (name, channels) => {
    expect(audio(await probe(fixture(name))).map((t) => t.channels)).toEqual(channels)
  })

  it('reads a bare WAV file', async () => {
    const info = await probe(fixture('pcm-71.wav'))
    expect(info).toMatchObject({ container: 'wav', start: 0 })
    expect(info.duration).toBeCloseTo(1, 2)
    expect(audio(info)[0]).toMatchObject({ codec: 'pcm-s16', sampleRate: 16000, bitDepth: 16 })
  })

  it.each([
    ['flac.flac', 16],
    ['flac-24.flac', 24],
    ['h264-flac.mkv', 16],
    ['h264-pcm.mov', 16],
    ['h264-aac.mp4', null],
    ['vp9-opus.webm', null],
  ])('reads the bit depth of %s’s lossless audio: %s', async (name, bits) => {
    expect(audio(await probe(fixture(name)))[0].bitDepth).toBe(bits)
  })

  it('refuses a file that isn’t media with the sentence the user sees', async () => {
    await expect(probe(fixture('notvideo.txt'))).rejects.toThrow(CANT_OPEN)
    expect(CANT_OPEN).toBe('Moviola can’t open this file. It reads MP4, MOV, MKV, WebM and MPEG-TS video.')
  })
})
