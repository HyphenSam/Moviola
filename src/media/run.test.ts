import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BlobSource, EncodedPacketSink, Input, ALL_FORMATS } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import type { AudioTrack, MediaInfo } from '@/lib/info'
import { DEFAULT_EXTRACT_AUDIO, planExtractAudio, type ExtractAudioSettings } from '@/lib/plans/extract-audio'
import type { Plan } from '@/lib/plan'
import { ALL_CAPABLE } from '@/lib/testing'
import { CONTAINER_CODECS } from './formats'
import { probe } from './probe'
import { CANCELLED, floatToInt, run } from './run'

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
    ['h264-ac3.mkv', null, 'h264-ac3.mka', 'mkv', 'ac3'],
    ['h264-pcm.mov', null, 'h264-pcm.wav', 'wav', 'pcm-s16'],
    ['h264-flac.mkv', null, 'h264-flac.flac', 'flac', 'flac'],
    ['flac.flac', null, 'flac.flac', 'flac', 'flac'],
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
})
