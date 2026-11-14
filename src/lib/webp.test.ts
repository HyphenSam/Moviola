import { describe, expect, it } from 'vitest'
import { webpAnimationWriter } from './webp'

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0))
const u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]
const u24 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)

/** A chunk as it sits in a file: FourCC, little-endian size, payload, a pad byte when the size is odd. */
const chunk = (fourcc: string, payload: number[]) => [
  ...ascii(fourcc),
  ...u32(payload.length),
  ...payload,
  ...(payload.length % 2 ? [0] : []),
]
const riff = (...chunks: number[][]) => {
  const body = [...ascii('WEBP'), ...chunks.flat()]
  return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body])
}

/** The chunks of a WebP file, or of an ANMF payload's frame data: FourCC and payload. */
function chunks(bytes: Uint8Array, from = 12): { fourcc: string; payload: Uint8Array }[] {
  const found = []
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let at = from; at < bytes.length;) {
    const size = view.getUint32(at + 4, true)
    found.push({
      fourcc: String.fromCharCode(...bytes.subarray(at, at + 4)),
      payload: bytes.subarray(at + 8, at + 8 + size),
    })
    at += 8 + size + (size % 2)
  }
  return found
}

// The encoder's bitstreams are opaque to the writer, so any bytes stand in for them.
const lossy = (n: number) => riff(chunk('VP8 ', [n, 1, 2, 3]))

function write(frames: Uint8Array[], options = { width: 480, height: 270, frameRate: 15, loop: true }) {
  const writer = webpAnimationWriter(options)
  for (const frame of frames) writer.add(frame)
  return writer.finish()
}

describe('webpAnimationWriter', () => {
  it('writes a RIFF WebP whose size counts everything after it, opening with VP8X and ANIM', () => {
    const file = write([lossy(1), lossy(2)])
    expect(String.fromCharCode(...file.subarray(0, 4))).toBe('RIFF')
    expect(new DataView(file.buffer).getUint32(4, true)).toBe(file.length - 8)
    expect(String.fromCharCode(...file.subarray(8, 12))).toBe('WEBP')

    const [vp8x, anim, ...rest] = chunks(file)
    expect(vp8x.fourcc).toBe('VP8X')
    // The animation flag, no alpha; then the canvas size less one, 24 bits each.
    expect(vp8x.payload[0]).toBe(0x02)
    expect(u24(vp8x.payload, 4)).toBe(479)
    expect(u24(vp8x.payload, 7)).toBe(269)
    expect(anim.fourcc).toBe('ANIM')
    // A transparent background, and a loop count of 0: forever.
    expect([...anim.payload]).toEqual([0, 0, 0, 0, 0, 0])
    expect(rest.map((c) => c.fourcc)).toEqual(['ANMF', 'ANMF'])
  })

  it('plays once with Loop off', () => {
    const [, anim] = chunks(write([lossy(1)], { width: 320, height: 180, frameRate: 10, loop: false }))
    expect(new DataView(anim.payload.buffer, anim.payload.byteOffset).getUint16(4, true)).toBe(1)
  })

  it('places each frame whole at the corner, replacing the last, holding each still’s bitstream', () => {
    const frames = chunks(write([lossy(1), lossy(2)])).slice(2)
    frames.forEach(({ payload }, i) => {
      expect(u24(payload, 0)).toBe(0)
      expect(u24(payload, 3)).toBe(0)
      expect(u24(payload, 6)).toBe(479)
      expect(u24(payload, 9)).toBe(269)
      // No blending (bit 1) and no disposal (bit 0): each frame covers the canvas.
      expect(payload[15]).toBe(0x02)
      expect(chunks(payload, 16)).toEqual([{ fourcc: 'VP8 ', payload: new Uint8Array([i + 1, 1, 2, 3]) }])
    })
  })

  it('times frames in milliseconds so a second of frames lasts a second (67, 66, 67 at 15 fps)', () => {
    const frames = chunks(write(Array.from({ length: 15 }, (_, i) => lossy(i)))).slice(2)
    const durations = frames.map(({ payload }) => u24(payload, 12))
    expect(durations.slice(0, 3)).toEqual([67, 66, 67])
    expect(durations.reduce((a, b) => a + b)).toBe(1000)
  })

  it('takes the alpha and bitstream from an extended still, leaving its metadata, and says the animation has alpha', () => {
    const still = riff(
      chunk('VP8X', [0x10, 0, 0, 0, 1, 0, 0, 1, 0, 0]),
      chunk('ALPH', [9, 9, 9]),
      chunk('VP8 ', [7, 7]),
      chunk('EXIF', [1, 2]),
    )
    const [vp8x, , frame] = chunks(write([still]))
    expect(vp8x.payload[0]).toBe(0x12)
    expect(chunks(frame.payload, 16)).toEqual([
      { fourcc: 'ALPH', payload: new Uint8Array([9, 9, 9]) },
      { fourcc: 'VP8 ', payload: new Uint8Array([7, 7]) },
    ])
    // ALPH's odd payload keeps its pad byte, so the ANMF payload stays even.
    expect(frame.payload.length).toBe(16 + 12 + 10)
  })

  it('takes a lossless still’s bitstream too', () => {
    const [, , frame] = chunks(write([riff(chunk('VP8L', [0x2f, 1, 2, 3, 4]))]))
    expect(chunks(frame.payload, 16)).toEqual([{ fourcc: 'VP8L', payload: new Uint8Array([0x2f, 1, 2, 3, 4]) }])
  })

  it('refuses anything that isn’t a still WebP', () => {
    const writer = webpAnimationWriter({ width: 2, height: 2, frameRate: 10, loop: true })
    expect(() => writer.add(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))).toThrow(
      'The browser didn’t make a WebP frame.',
    )
    expect(() => writer.add(riff(chunk('EXIF', [1, 2])))).toThrow('The browser didn’t make a WebP frame.')
  })
})
