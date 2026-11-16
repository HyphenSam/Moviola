import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  EncodedPacketSink,
  Input,
  MkvOutputFormat,
  Output,
  Quality,
  type ConversionAudioOptions,
} from 'mediabunny'
import { describe, expect, it } from 'vitest'
import type { AudioTrack, MediaInfo } from '@/lib/info'
import { DEFAULT_EXTRACT_AUDIO, planExtractAudio, type ExtractAudioSettings } from '@/lib/plans/extract-audio'
import type { Plan } from '@/lib/plan'
import { planChangeContainer, type ContainerChoice } from '@/lib/plans/change-container'
import { planRemoveAudio } from '@/lib/plans/remove-audio'
import { planTrim, type TimeRange, type TrimMode } from '@/lib/plans/trim'
import { ALL_CAPABLE } from '@/lib/testing'
import { CONTAINER_CODECS } from './formats'
import { probe } from './probe'
import { CANCELLED, floatToInt, JobProblem, run, transcodedCopies, videoOptions } from './run'

const fixture = (name: string) => new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)

async function extract(name: string, trackId: number | null = null, over: Partial<ExtractAudioSettings> = {}) {
  const source = fixture(name)
  const info = await probe(source)
  const settings = { ...DEFAULT_EXTRACT_AUDIO, trackId, ...over }
  const { plan, problems } = planExtractAudio(info, settings, CONTAINER_CODECS, ALL_CAPABLE)
  if (!plan) throw new Error(problems.join(' '))
  const result = await run(source, plan, null)
  const output = new File([result.buffer!], plan.name)
  return { source, info, plan, result, output, outInfo: await probe(output) }
}

/** The ADTS header Mediabunny leaves on AAC packets read from MPEG-TS: framing, not audio. MP4
 * stores the same frames without it. 7 bytes, or 9 with a CRC. */
function withoutAdts(data: Uint8Array): Uint8Array {
  if (data[0] !== 0xff || (data[1] & 0xf6) !== 0xf0) return data
  return data.subarray(data[1] & 1 ? 7 : 9)
}

/** Every packet of a track, joined: the encoded audio exactly as the file stores it. */
async function packetBytes(file: File, trackId: number): Promise<Uint8Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = (await input.getTracks()).find((t) => t.id === trackId)!
    const parts: Uint8Array[] = []
    for await (const packet of new EncodedPacketSink(track).packets()) parts.push(withoutAdts(packet.data))
    return Buffer.concat(parts)
  } finally {
    input.dispose()
  }
}

const audioId = (info: MediaInfo) => info.tracks.find((t) => t.kind === 'audio')!.id

// SPEC.md 6.2's Original format, end to end against the fixtures.
describe('extract audio, Original', () => {
  it.each([
    ['h264-aac.mp4', null, 'h264-aac.m4a', 'mp4', 'aac'],
    ['h264-aac.ts', null, 'h264-aac.m4a', 'mp4', 'aac'],
    ['aac.m4a', null, 'aac.m4a', 'mp4', 'aac'],
    ['h264-aac-2audio.mkv', null, 'h264-aac-2audio.m4a', 'mp4', 'aac'],
    ['h264-aac-2audio.mkv', 3, 'h264-aac-2audio (track 2).m4a', 'mp4', 'aac'],
    ['vp9-opus.webm', null, 'vp9-opus.opus', 'ogg', 'opus'],
    ['opus-51.webm', null, 'opus-51.opus', 'ogg', 'opus'],
    ['h264-ac3.mkv', null, 'h264-ac3.mka', 'mkv', 'ac3'],
    ['h264-pcm.mov', null, 'h264-pcm.wav', 'wav', 'pcm-s16'],
    ['h264-flac.mkv', null, 'h264-flac.flac', 'flac', 'flac'],
    ['flac.flac', null, 'flac.flac', 'flac', 'flac'],
    ['pcm-51.wav', null, 'pcm-51.wav', 'wav', 'pcm-s16'],
    ['pcm-71.wav', null, 'pcm-71.wav', 'wav', 'pcm-s16'],
  ] as const)('%s (track %s) → %s', async (name, trackId, outName, container, codec) => {
    const { source, info, plan, result, output, outInfo } = await extract(name, trackId)
    expect(plan.name).toBe(outName)
    expect(outInfo.container).toBe(container)
    expect(outInfo.tracks.map((t) => [t.kind, t.codec])).toEqual([['audio', codec]])
    expect(result.size).toBe(output.size)

    const sourceTrack = trackId ?? audioId(info)
    const original = await packetBytes(source, sourceTrack)
    expect(original.length).toBeGreaterThan(1000)
    expect(Buffer.from(await packetBytes(output, audioId(outInfo))).equals(original)).toBe(true)
    expect(outInfo.duration).toBeCloseTo(info.duration, 0)
    const channels = (i: MediaInfo, id: number) => (i.tracks.find((t) => t.id === id) as AudioTrack).channels
    expect(channels(outInfo, audioId(outInfo))).toBe(channels(info, sourceTrack))
  })

  it('can’t copy the MP3 in h264-mp3.mov, whose codec Mediabunny 1.65 can’t name', async () => {
    // As probe.test.ts says: when Mediabunny learns MOV's '.mp3' entry this becomes an .mp3 copy.
    await expect(extract('h264-mp3.mov')).rejects.toThrow(
      'Moviola can’t tell which codec this audio track uses, so it can’t copy it.',
    )
  })

  it('has nothing to extract from a video without sound', async () => {
    await expect(extract('h264-only.mp4')).rejects.toThrow('This file has no audio track.')
  })
})

// MP3, WAV and FLAC re-encode, which needs the source decoded. Node has no WebCodecs, but Mediabunny
// decodes PCM itself and the MP3 and FLAC add-ons are WebAssembly, so the PCM fixture runs end to
// end here. Other sources are checked by hand in the browser.
describe('extract audio, converted', () => {
  it.each([
    [{ format: 'wav', wavBits: 16 }, 'h264-pcm.wav', 'wav', 'pcm-s16', 16],
    [{ format: 'wav', wavBits: 24 }, 'h264-pcm.wav', 'wav', 'pcm-s24', 24],
    // 16-bit in, 16-bit FLAC out: the depth follows the source, not the decoder's sample format.
    [{ format: 'flac' }, 'h264-pcm.flac', 'flac', 'flac', 16],
    [{ format: 'mp3', mp3Bitrate: 128 }, 'h264-pcm.mp3', 'mp3', 'mp3', null],
  ] as const)('h264-pcm.mov as %o → %s', async (over, outName, container, codec, bitDepth) => {
    const { info, plan, output, outInfo } = await extract('h264-pcm.mov', null, over)
    expect(plan.name).toBe(outName)
    expect(outInfo.container).toBe(container)
    expect(outInfo.tracks).toHaveLength(1)
    const [source, out] = [info, outInfo].map((i) => i.tracks.find((t) => t.kind === 'audio')!) as AudioTrack[]
    expect(out.codec).toBe(codec)
    expect(out.bitDepth).toBe(bitDepth)
    // MP3 resamples 16 kHz to 48 kHz to reach its full bitrate range; the rest keep the rate.
    expect([out.sampleRate, out.channels]).toEqual([plan.audio?.sampleRate ?? source.sampleRate, source.channels])
    expect(outInfo.duration).toBeCloseTo(info.duration, 1)
    expect(output.size).toBeGreaterThan(1000)
  })

  it('writes 16-bit WAV from 16-bit PCM sample for sample', async () => {
    const { source, info, output, outInfo } = await extract('h264-pcm.mov', null, { format: 'wav' })
    const original = await packetBytes(source, audioId(info))
    expect(Buffer.from(await packetBytes(output, audioId(outInfo))).equals(original)).toBe(true)
  })

  it.each([128, 192, 256, 320] as const)('writes MP3 at %i kbps', async (kbps) => {
    const { outInfo } = await extract('h264-pcm.mov', null, { format: 'mp3', mp3Bitrate: kbps })
    const bitrate = outInfo.tracks[0].bitrate!
    expect(Math.abs(bitrate - kbps * 1000) / (kbps * 1000)).toBeLessThan(0.03)
  })
})

const int16 = (bytes: Uint8Array) => new Int16Array(bytes.slice().buffer)

/** Stereo from 5.1 or 7.1 (L, R, C, LFE, then the surround pairs), as ITU-R BS.775 mixes it: each
 * side keeps its front channel and takes the centre and its own surrounds at √½; the LFE is left out. */
function stereoMix(frame: Int16Array): [number, number] {
  const [l, r, c, , ...surrounds] = frame
  const side = (front: number, odd: number) =>
    front + Math.SQRT1_2 * surrounds.reduce((sum, s, i) => (i % 2 === odd ? sum + s : sum), c)
  return [side(l, 0), side(r, 1)]
}

describe('extract audio, converted from surround', () => {
  it.each(['pcm-51.wav', 'pcm-71.wav'])('%s keeps every channel, in order, in 16-bit WAV', async (name) => {
    const { source, info, plan, output, outInfo } = await extract(name, null, { format: 'wav', wavBits: 16 })
    expect(plan.lossless).toBe(true)
    expect((outInfo.tracks[0] as AudioTrack).channels).toBe((info.tracks[0] as AudioTrack).channels)
    const original = await packetBytes(source, audioId(info))
    expect(Buffer.from(await packetBytes(output, audioId(outInfo))).equals(original)).toBe(true)
  })

  it.each([
    ['pcm-51.wav', { format: 'wav', wavBits: 24 }, 'pcm-s24', 6],
    ['pcm-51.wav', { format: 'flac' }, 'flac', 6],
    ['pcm-71.wav', { format: 'wav', wavBits: 24 }, 'pcm-s24', 8],
    ['pcm-71.wav', { format: 'flac' }, 'flac', 8],
    ['pcm-51.wav', { format: 'mp3' }, 'mp3', 2],
    ['pcm-71.wav', { format: 'mp3' }, 'mp3', 2],
  ] as const)('%s as %o → %s with %i channels', async (name, over, codec, channels) => {
    const { info, outInfo } = await extract(name, null, over)
    expect(outInfo.tracks).toHaveLength(1)
    expect(outInfo.tracks[0]).toMatchObject({ kind: 'audio', codec, channels })
    expect(outInfo.duration).toBeCloseTo(info.duration, 1)
  })

  // MP3 holds two channels at most. Mixed to 16-bit WAV here so the result can be read back.
  it.each(['pcm-51.wav', 'pcm-71.wav'])('%s mixes down to stereo with the centre and surrounds in', async (name) => {
    const source = fixture(name)
    const info = await probe(source)
    const plan: Plan = {
      kind: 'audio',
      container: 'wav',
      name: 'mix.wav',
      mimeType: 'audio/wav',
      lossless: false,
      keep: [audioId(info)],
      audio: { codec: 'pcm-s16', numberOfChannels: 2 },
    }
    const output = new File([(await run(source, plan, null)).buffer!], plan.name)
    const outInfo = await probe(output)
    expect((outInfo.tracks[0] as AudioTrack).channels).toBe(2)

    const channels = (info.tracks[0] as AudioTrack).channels
    const before = int16(await packetBytes(source, audioId(info)))
    const after = int16(await packetBytes(output, audioId(outInfo)))
    expect(after.length / 2).toBe(before.length / channels)
    let worst = 0
    for (let i = 0; i < after.length / 2; i++) {
      const [l, r] = stereoMix(before.subarray(i * channels, (i + 1) * channels))
      worst = Math.max(worst, Math.abs(after[i * 2] - l), Math.abs(after[i * 2 + 1] - r))
    }
    expect(worst).toBeLessThanOrEqual(2)
  })
})

describe('floatToInt', () => {
  it('puts every 24-bit value exactly where 24-bit FLAC reads it back, eight bits up', () => {
    const values = [0, 1, -1, 235 << 8, 0x7fffff, -0x800000, 1234567, -7654321]
    const out = floatToInt(new Float32Array(values.map((v) => v / 2 ** 23)), 32)
    expect(out).toBeInstanceOf(Int32Array)
    expect([...out].map((v) => v >> 8)).toEqual(values)
    expect([...out].every((v) => (v & 0xff) === 0)).toBe(true)
  })

  // Chrome's own s32 to s16 copy gives 234 for this sample of the FLAC fixture.
  it('gives 16-bit values back exactly', () => {
    const values = [0, 235, -235, 32767, -32768, 1161]
    const out = floatToInt(new Float32Array(values.map((v) => v / 32768)), 16)
    expect(out).toBeInstanceOf(Int16Array)
    expect([...out]).toEqual(values)
  })

  it('clamps full scale', () => {
    expect([...floatToInt(new Float32Array([1, -1, 1.5]), 32)]).toEqual([2147483647, -2147483648, 2147483647])
    expect([...floatToInt(new Float32Array([1, -1.5]), 16)]).toEqual([32767, -32768])
  })
})

/** A WritableStream that keeps what's written, like a FileSystemWritableFileStream: positioned
 * writes, and either close (commit) or abort (discard). */
function fakeFileStream() {
  let bytes = new Uint8Array(0)
  const state = { closed: false, aborted: false }
  const writable = new WritableStream<{ type: 'write'; data: Uint8Array; position: number }>({
    write({ data, position }) {
      if (position + data.length > bytes.length) {
        const grown = new Uint8Array(position + data.length)
        grown.set(bytes)
        bytes = grown
      }
      bytes.set(data, position)
    },
    close: () => void (state.closed = true),
    abort: () => void (state.aborted = true),
  })
  return { writable, state, bytes: () => bytes }
}

const m4aPlan = async (name = 'h264-aac.mp4') => {
  const source = fixture(name)
  return {
    source,
    plan: planExtractAudio(await probe(source), DEFAULT_EXTRACT_AUDIO, CONTAINER_CODECS, ALL_CAPABLE).plan!,
  }
}

describe('run', () => {
  it('streams to a writable and closes it, reserving the index at the front of an MP4', async () => {
    const { source, plan } = await m4aPlan()
    const stream = fakeFileStream()
    const result = await run(source, plan, stream.writable)
    expect(stream.state).toEqual({ closed: true, aborted: false })
    expect(result).toEqual({ size: stream.bytes().length, buffer: null })
    const bytes = stream.bytes()
    // fastStart 'reserve': the moov box comes before the media data.
    const text = new TextDecoder('latin1').decode(bytes)
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'))
    const info = await probe(new File([bytes], plan.name))
    expect(info.tracks.map((t) => t.codec)).toEqual(['aac'])
  })

  it('reports progress as a fraction up to 1', async () => {
    const { source, plan } = await m4aPlan()
    const seen: number[] = []
    await run(source, plan, null, { onProgress: (f) => seen.push(f) })
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(1)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('discards what it streamed when cancelled midway, never committing it', async () => {
    const { source, plan } = await m4aPlan()
    const stream = fakeFileStream()
    const controller = new AbortController()
    const job = run(source, plan, stream.writable, {
      signal: controller.signal,
      onProgress: (f) => f > 0 && controller.abort(),
    })
    await expect(job).rejects.toThrow(CANCELLED)
    expect(stream.state).toEqual({ closed: false, aborted: true })
  })

  it('discards the stream when cancelled before it starts', async () => {
    const { source, plan } = await m4aPlan()
    const stream = fakeFileStream()
    await expect(run(source, plan, stream.writable, { signal: AbortSignal.abort() })).rejects.toThrow(CANCELLED)
    expect(stream.state).toEqual({ closed: false, aborted: true })
  })

  it('says why, in a sentence, when a kept track can’t be copied, and discards the stream', async () => {
    const source = fixture('h264-aac.mp4')
    const plan: Plan = {
      kind: 'video',
      container: 'webm',
      name: 'x.webm',
      mimeType: 'video/webm',
      lossless: true,
      keep: [1],
    }
    const stream = fakeFileStream()
    await expect(run(source, plan, stream.writable)).rejects.toThrow(
      'WebM can’t hold this H.264 video without re-encoding it.',
    )
    expect(stream.state).toEqual({ closed: false, aborted: true })
  })

  it('refuses a plan that contradicts itself or the file before Mediabunny sees it', async () => {
    const source = fixture('h264-aac.mp4')
    const plan: Plan = {
      kind: 'video',
      container: 'mkv',
      name: 'h264-aac.mkv',
      mimeType: 'video/x-matroska',
      lossless: true,
      keep: [1, 9],
      video: { codec: 'avc', width: 1279, height: 720 },
    }
    const stream = fakeFileStream()
    const job = run(source, plan, stream.writable)
    await expect(job).rejects.toThrow(JobProblem)
    await expect(job).rejects.toThrow(
      'Moviola made a plan it can’t run: It says no quality is lost, but it re-encodes the video. ' +
        'It keeps track 9, which isn’t in the file. H.264 needs an even width and height, not 1279 × 720.',
    )
    expect(stream.state).toEqual({ closed: false, aborted: true })
    expect(stream.bytes().length).toBe(0)
  })
})

type Packet = { timestamp: number; data: Buffer }

/** A track's packets in decode order, with their timestamps. */
async function packets(file: File, trackId: number): Promise<Packet[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = (await input.getTracks()).find((t) => t.id === trackId)!
    const list: Packet[] = []
    for await (const p of new EncodedPacketSink(track).packets()) {
      list.push({ timestamp: p.timestamp, data: Buffer.from(withoutAdts(p.data)) })
    }
    return list
  } finally {
    input.dispose()
  }
}

const trackOf = (info: MediaInfo, kind: 'video' | 'audio') => info.tracks.find((t) => t.kind === kind)!.id

/** Where `part` sits inside `whole`, packet for packet and byte for byte, or -1. */
function runOf(whole: Packet[], part: Packet[]): number {
  const at = whole.findIndex((p) => p.data.equals(part[0].data))
  const same = at >= 0 && part.every((p, i) => whole[at + i]?.data.equals(p.data))
  return same ? at : -1
}

async function trim(name: string, range: TimeRange, mode: TrimMode = 'fast') {
  const source = fixture(name)
  const info = await probe(source)
  const { plan, problems } = planTrim(info, range, mode, CONTAINER_CODECS, ALL_CAPABLE)
  if (!plan) throw new Error(problems.join(' '))
  const result = await run(source, plan, null)
  const output = new File([result.buffer!], plan.name)
  return { source, info, plan, output, outInfo: await probe(output) }
}

// SPEC.md 6.3's Fast trim, end to end: everything is copied, so it runs in Node.
describe('trim, Fast', () => {
  it('cuts h264-aac.mp4 from 3.0 s at the 2.0 s keyframe, keeping every packet to the out point', async () => {
    const { source, info, plan, output, outInfo } = await trim('h264-aac.mp4', { start: 3, end: 3.8 })
    expect(plan).toMatchObject({ name: 'h264-aac (trimmed).mp4', container: 'mp4', lossless: true })
    expect(outInfo.container).toBe('mp4')
    expect(outInfo.tracks.map((t) => [t.kind, t.codec])).toEqual([
      ['video', 'avc'],
      ['audio', 'aac'],
    ])

    // Video: the source's packets from the 2.0 s keyframe up to the out point, byte for byte, starting
    // at the output's 0.
    const sourceVideo = await packets(source, trackOf(info, 'video'))
    const outVideo = await packets(output, trackOf(outInfo, 'video'))
    const expected = sourceVideo.filter((p) => p.timestamp >= 2 - 1e-6 && p.timestamp < 3.8 - 1e-6)
    expect(outVideo.length).toBe(expected.length)
    expect(outVideo.every((p, i) => p.data.equals(expected[i].data))).toBe(true)
    expect(Math.min(...outVideo.map((p) => p.timestamp))).toBeCloseTo(0, 3)

    // Audio: an unbroken run of the source's packets from the keyframe on, still in sync with the picture.
    const sourceAudio = await packets(source, trackOf(info, 'audio'))
    const outAudio = await packets(output, trackOf(outInfo, 'audio'))
    const at = runOf(sourceAudio, outAudio)
    expect(at).toBeGreaterThan(0)
    expect(sourceAudio[at].timestamp).toBeLessThanOrEqual(2)
    expect(sourceAudio[at].timestamp).toBeGreaterThan(2 - 0.1)
    expect(outAudio[0].timestamp).toBeCloseTo(sourceAudio[at].timestamp - 2, 3)
    expect(sourceAudio[at + outAudio.length - 1].timestamp).toBeLessThan(3.8)

    // From the keyframe to the out point.
    expect(outInfo.duration).toBeCloseTo(1.8, 1)
  })

  it('cuts a late-starting MPEG-TS on the playhead’s clock and keeps it MPEG-TS', async () => {
    const { info, output, outInfo } = await trim('h264-aac.ts', { start: 3, end: 3.8 })
    expect(info.start).toBeGreaterThan(1)
    expect(output.name).toBe('h264-aac (trimmed).ts')
    expect(outInfo.container).toBe('mpegts')
    // From the keyframe 2 s into the video (which starts a frame after the file does), plus the few
    // packets of AAC pre-roll before it: MPEG-TS can't hold them at negative times, so they're shifted in.
    expect(outInfo.duration).toBeGreaterThan(3.8 - 2.02 - 0.01)
    expect(outInfo.duration).toBeLessThan(3.8 - 2.02 + 0.1)
  })

  it.each([
    ['aac.m4a', 'aac (trimmed).m4a', 'mp4', 'aac'],
    ['flac.flac', 'flac (trimmed).flac', 'flac', 'flac'],
    ['pcm-51.wav', 'pcm-51 (trimmed).wav', 'wav', 'pcm-s16'],
    ['opus-51.webm', 'opus-51 (trimmed).webm', 'webm', 'opus'],
  ] as const)('cuts the audio file %s to the range, copied', async (name, outName, container, codec) => {
    const range = { start: 0.25, end: 0.75 }
    const { source, info, output, outInfo } = await trim(name, range)
    expect(output.name).toBe(outName)
    expect(outInfo.container).toBe(container)
    expect(outInfo.tracks.map((t) => [t.kind, t.codec])).toEqual([['audio', codec]])
    // Copying cuts between packets (96 ms of FLAC, 128 ms of the WAV), and Opus brings its pre-roll,
    // so the result covers the range with a little to spare.
    expect(outInfo.duration).toBeGreaterThanOrEqual(0.5 - 0.01)
    expect(outInfo.duration).toBeLessThan(0.5 + 0.3)
    const original = await packets(source, trackOf(info, 'audio'))
    const out = await packets(output, trackOf(outInfo, 'audio'))
    expect(runOf(original, out)).toBeGreaterThanOrEqual(0)
  })
})

// Precise trim re-encodes video, which needs WebCodecs; the encoder settings are checked here and the
// result by hand in the browser.
describe('videoOptions', () => {
  it('re-encodes to the plan’s codec at the source’s bitrate, as a bitrate rather than a quality level', () => {
    expect(videoOptions({ codec: 'avc', bitrate: 4_000_000 })).toEqual({
      codec: 'avc',
      quality: new Quality({ bitrate: 4_000_000 }),
      forceTranscode: true,
      hardwareAcceleration: 'no-preference',
    })
  })

  it('resizes to the plan’s display size and caps the frame rate, stretching nothing beyond the rounding', () => {
    expect(videoOptions({ codec: 'hevc', bitrate: 474_000, width: 720, height: 1280, frameRate: 30 })).toEqual({
      codec: 'hevc',
      quality: new Quality({ bitrate: 474_000 }),
      width: 720,
      height: 1280,
      fit: 'fill',
      frameRate: 30,
      forceTranscode: true,
      hardwareAcceleration: 'no-preference',
    })
  })

  it('holds the bitrate constant when the plan says so, for a target size', () => {
    expect(videoOptions({ codec: 'avc', bitrate: 679_000, constantBitrate: true }).quality).toEqual(
      new Quality({ bitrate: 679_000, bitrateMode: 'constant' }),
    )
  })

  it('leaves the quality to the encoder when the source’s bitrate isn’t known', () => {
    expect(videoOptions({ codec: 'vp9' })).toEqual({
      codec: 'vp9',
      forceTranscode: true,
      hardwareAcceleration: 'no-preference',
    })
  })
})

// Plans that re-encode one kind of track and copy the other. Mediabunny's copy mode is per conversion,
// and 'forced' refuses the re-encoded track, so these run as 'preferred', where Mediabunny may also
// transcode a track the plan copies; run checks what it decided. Node has no WebCodecs, but Mediabunny
// reads and writes PCM itself.
describe('mixed plans', () => {
  // h264-pcm.mov: H.264 video (1), 16-bit PCM audio (2).
  const mixed: Plan = {
    kind: 'video',
    container: 'mkv',
    name: 'h264-pcm.mkv',
    mimeType: 'video/x-matroska',
    lossless: false,
    keep: [1, 2],
    audio: { codec: 'pcm-s16' },
  }

  it('copies the video byte for byte while it re-encodes the audio', async () => {
    const source = fixture('h264-pcm.mov')
    const result = await run(source, mixed, null)
    const output = new File([result.buffer!], mixed.name)
    const outInfo = await probe(output)
    expect(outInfo.tracks.map((t) => [t.kind, t.codec])).toEqual([
      ['video', 'avc'],
      ['audio', 'pcm-s16'],
    ])
    const before = await packets(source, 1)
    const after = await packets(output, trackOf(outInfo, 'video'))
    expect(before.length).toBeGreaterThan(10)
    expect(after.map((p) => p.data)).toEqual(before.map((p) => p.data))
  })

  /** Mediabunny's decisions for h264-pcm.mov's audio into MKV, with the video left out. */
  async function audioConversion(audio: ConversionAudioOptions) {
    const input = new Input({ source: new BlobSource(fixture('h264-pcm.mov')), formats: ALL_FORMATS })
    const output = new Output({ format: new MkvOutputFormat(), target: new BufferTarget() })
    const conversion = await Conversion.init({
      input,
      output,
      video: { discard: true },
      audio,
      copy: { mode: 'preferred' },
      showWarnings: false,
    })
    input.dispose()
    return conversion
  }
  const copyAudio: Plan = {
    kind: 'audio',
    container: 'mkv',
    name: 'h264-pcm.mka',
    mimeType: 'audio/x-matroska',
    lossless: true,
    keep: [2],
  }

  it('names a track the plan copies that Mediabunny would transcode', async () => {
    // Resampling can't be done by copying, so 'preferred' transcodes it.
    const conversion = await audioConversion({ sampleRate: 24000 })
    expect(transcodedCopies(copyAudio, conversion)).toEqual([
      'The PCM 16-bit audio (track 2) would be re-encoded, but it’s meant to be copied as it is.',
    ])
  })

  it('passes tracks copied as planned, and tracks the plan re-encodes', async () => {
    expect(transcodedCopies(copyAudio, await audioConversion({}))).toEqual([])
    const reencode: Plan = { ...copyAudio, lossless: false, audio: { codec: 'pcm-s16', sampleRate: 24000 } }
    expect(transcodedCopies(reencode, await audioConversion({ sampleRate: 24000 }))).toEqual([])
  })
})

/** Runs a planner's plan on `source` and reads the result back. */
async function runPlanned(source: File, planned: { plan?: Plan; problems?: string[] }) {
  if (!planned.plan) throw new Error(planned.problems!.join(' '))
  const result = await run(source, planned.plan, null)
  const output = new File([result.buffer!], planned.plan.name)
  return { plan: planned.plan, output, outInfo: await probe(output) }
}

/** Every packet of each kept source track is in the output's track of the same kind and order, byte
 * for byte, and every track keeps its timing against the others. */
async function expectSamePackets(source: File, info: MediaInfo, keep: number[], output: File, outInfo: MediaInfo) {
  const kept = info.tracks.filter((t) => keep.includes(t.id))
  expect(outInfo.tracks.map((t) => [t.kind, t.codec])).toEqual(kept.map((t) => [t.kind, t.codec]))
  const shifts: number[] = []
  for (const [i, track] of kept.entries()) {
    const before = await packets(source, track.id)
    const after = await packets(output, outInfo.tracks[i].id)
    expect(before.length).toBeGreaterThan(10)
    expect(after.length).toBe(before.length)
    expect(after.every((p, j) => p.data.equals(before[j].data))).toBe(true)
    const shift = after[0].timestamp - before[0].timestamp
    expect(after.every((p, j) => Math.abs(p.timestamp - before[j].timestamp - shift) < 1e-3)).toBe(true)
    shifts.push(shift)
  }
  // Mediabunny's MKV writer can't start before 0, so AAC's priming (−21 ms) moves every track 21 ms
  // later, together; nothing else moves.
  expect(shifts.every((s) => Math.abs(s - shifts[0]) < 1e-3)).toBe(true)
  expect(Math.abs(shifts[0])).toBeLessThan(0.025)
}

async function changeContainer(source: File, container: ContainerChoice, dropped: number[] = []) {
  const info = await probe(source)
  const done = await runPlanned(source, planChangeContainer(info, container, dropped, CONTAINER_CODECS))
  return { info, ...done }
}

// SPEC.md 6.4, end to end: nothing is re-encoded, so it runs in Node.
describe('change container', () => {
  it('rewraps vp9-opus.webm as MP4, every packet untouched', async () => {
    const source = fixture('vp9-opus.webm')
    const { info, plan, output, outInfo } = await changeContainer(source, 'mp4')
    expect(plan.name).toBe('vp9-opus.mp4')
    expect(outInfo.container).toBe('mp4')
    await expectSamePackets(source, info, plan.keep, output, outInfo)
    expect(outInfo.duration).toBeCloseTo(info.duration, 1)
  })

  it('rewraps h264-aac.mp4 as MKV and back again, every packet untouched both ways', async () => {
    const source = fixture('h264-aac.mp4')
    const there = await changeContainer(source, 'mkv')
    expect(there.plan.name).toBe('h264-aac.mkv')
    expect(there.outInfo.container).toBe('mkv')
    await expectSamePackets(source, there.info, there.plan.keep, there.output, there.outInfo)

    const back = await changeContainer(there.output, 'mp4')
    expect(back.plan.name).toBe('h264-aac.mp4')
    expect(back.outInfo.container).toBe('mp4')
    await expectSamePackets(source, there.info, there.plan.keep, back.output, back.outInfo)
    expect(back.outInfo.duration).toBeCloseTo(there.info.duration, 1)
  })

  it('refuses to put h264-ac3.mkv into WebM, naming its codec and the way out', async () => {
    const info = await probe(fixture('h264-ac3.mkv'))
    expect(planChangeContainer(info, 'webm', [], CONTAINER_CODECS).problems).toEqual([
      'WebM can’t hold this video’s H.264. Use Compress to convert it to VP9 or AV1.',
    ])
  })

  it('copies the metadata tags', async () => {
    // The fixtures carry no tags, so give one a title first.
    const tagged = new Output({ format: new MkvOutputFormat(), target: new BufferTarget() })
    const input = new Input({ source: new BlobSource(fixture('h264-aac.mp4')), formats: ALL_FORMATS })
    const conversion = await Conversion.init({ input, output: tagged, tags: { title: 'Harbour at dusk' } })
    await conversion.execute()
    const source = new File([(tagged.target as BufferTarget).buffer!], 'tagged.mkv')
    expect((await probe(source)).tags.title).toBe('Harbour at dusk')

    const { outInfo } = await changeContainer(source, 'mp4')
    expect(outInfo.tags.title).toBe('Harbour at dusk')
  })
})

// SPEC.md 6.5, end to end.
describe('remove audio', () => {
  it('copies h264-aac.mp4’s video without its sound', async () => {
    const source = fixture('h264-aac.mp4')
    const info = await probe(source)
    const { plan, output, outInfo } = await runPlanned(source, planRemoveAudio(info, [], CONTAINER_CODECS))
    expect(plan.name).toBe('h264-aac (no audio).mp4')
    expect(outInfo.container).toBe('mp4')
    await expectSamePackets(source, info, plan.keep, output, outInfo)
  })

  it('keeps only the French track of h264-aac-2audio.mkv', async () => {
    const source = fixture('h264-aac-2audio.mkv')
    const info = await probe(source)
    const french = info.tracks.find((t) => t.kind === 'audio' && t.language === 'fra')!
    const { plan, output, outInfo } = await runPlanned(source, planRemoveAudio(info, [french.id], CONTAINER_CODECS))
    expect(plan.name).toBe('h264-aac-2audio (edited).mkv')
    expect(outInfo.container).toBe('mkv')
    await expectSamePackets(source, info, plan.keep, output, outInfo)
    const audio = outInfo.tracks.filter((t): t is AudioTrack => t.kind === 'audio')
    expect(audio.map((t) => [t.language, t.channels])).toEqual([['fra', 6]])
  })
})
