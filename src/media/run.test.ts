import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { BlobSource, EncodedPacketSink, Input, ALL_FORMATS } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import type { MediaInfo } from '@/lib/info'
import { planExtractAudio } from '@/lib/plans/extract-audio'
import type { Plan } from '@/lib/plan'
import { CONTAINER_CODECS } from './formats'
import { probe } from './probe'
import { CANCELLED, run } from './run'

const fixture = (name: string) => new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)

async function extract(name: string, trackId: number | null = null) {
  const source = fixture(name)
  const info = await probe(source)
  const { plan, problems } = planExtractAudio(info, { trackId }, CONTAINER_CODECS)
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
  return { source, plan: planExtractAudio(await probe(source), { trackId: null }, CONTAINER_CODECS).plan! }
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
