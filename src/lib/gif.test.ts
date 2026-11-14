import { describe, expect, it } from 'vitest'
import { gifWriter } from './gif'

type Decoded = {
  version: string
  width: number
  height: number
  /** The NETSCAPE2.0 loop count: 0 is forever; null when there's no loop extension (play once). */
  loops: number | null
  frames: { delay: number; width: number; height: number; pixels: [number, number, number][] }[]
}

/** Reads a GIF block by block, decoding each frame's pixels, so the test checks what a browser would
 * show rather than trusting the encoder. */
function decodeGif(bytes: Uint8Array): Decoded {
  let at = 0
  const byte = () => bytes[at++]
  const word = () => byte() | (byte() << 8)
  const text = (n: number) => String.fromCharCode(...bytes.subarray(at, (at += n)))
  const table = (packed: number) => {
    const colours: [number, number, number][] = []
    for (let i = 0; i < 2 ** ((packed & 7) + 1); i++) colours.push([byte(), byte(), byte()])
    return colours
  }
  const subBlocks = () => {
    const parts: number[] = []
    for (let size = byte(); size; size = byte()) parts.push(...bytes.subarray(at, (at += size)))
    return parts
  }

  const version = text(6)
  const width = word()
  const height = word()
  const packed = byte()
  at += 2
  const global = packed & 0x80 ? table(packed) : []
  const result: Decoded = { version, width, height, loops: null, frames: [] }
  let delay = 0
  for (;;) {
    const block = byte()
    if (block === 0x3b) return result
    if (block === 0x21) {
      const label = byte()
      if (label === 0xf9) {
        at++ // block size
        at++ // packed
        delay = word()
        at += 2 // transparent index, terminator
      } else if (label === 0xff) {
        at++ // block size
        const id = text(11)
        const data = subBlocks()
        if (id === 'NETSCAPE2.0') result.loops = data[1] | (data[2] << 8)
      } else subBlocks()
    } else if (block === 0x2c) {
      at += 4
      const w = word()
      const h = word()
      const local = byte()
      const colours = local & 0x80 ? table(local) : global
      const minCodeSize = byte()
      const indices = lzw(minCodeSize, subBlocks(), w * h)
      result.frames.push({ delay, width: w, height: h, pixels: indices.map((i) => colours[i]) })
    } else throw new Error(`Unexpected block 0x${block.toString(16)} at ${at - 1}`)
  }
}

/** GIF's variable-width LZW, least significant bit first. */
function lzw(minCodeSize: number, data: number[], count: number): number[] {
  const clear = 1 << minCodeSize
  const end = clear + 1
  let size = minCodeSize + 1
  let dict: number[][] = []
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i])
    size = minCodeSize + 1
  }
  reset()
  const out: number[] = []
  let prev: number[] | null = null
  let bit = 0
  while (out.length < count) {
    let code = 0
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i
    if (code === clear) {
      reset()
      prev = null
      continue
    }
    if (code === end) break
    const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]]
    out.push(...entry)
    if (prev) {
      dict.push([...prev, entry[0]])
      if (dict.length === 1 << size && size < 12) size++
    }
    prev = entry
  }
  return out
}

/** A `width` × `height` RGBA frame, each pixel coloured by `colour(x, y)`. */
function frame(width: number, height: number, colour: (x: number, y: number) => [number, number, number]) {
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rgba.set([...colour(x, y), 255], (y * width + x) * 4)
    }
  }
  return rgba
}

const RED: [number, number, number] = [255, 0, 0]
const BLUE: [number, number, number] = [0, 0, 255]
const GREEN: [number, number, number] = [0, 255, 0]
const WHITE: [number, number, number] = [255, 255, 255]

describe('gifWriter', () => {
  it('writes a GIF89a of the given size with one image per frame, each showing its own picture', () => {
    const gif = gifWriter({ width: 8, height: 6, frameRate: 10, loop: true })
    gif.add(frame(8, 6, () => RED))
    gif.add(frame(8, 6, () => BLUE))
    gif.add(frame(8, 6, (x) => (x < 4 ? GREEN : WHITE)))
    const decoded = decodeGif(gif.finish())

    expect(decoded).toMatchObject({ version: 'GIF89a', width: 8, height: 6 })
    expect(decoded.frames).toHaveLength(3)
    expect(decoded.frames.every((f) => f.width === 8 && f.height === 6)).toBe(true)
    expect(new Set(decoded.frames[0].pixels.map(String))).toEqual(new Set([String(RED)]))
    expect(new Set(decoded.frames[1].pixels.map(String))).toEqual(new Set([String(BLUE)]))
    const third = decoded.frames[2].pixels
    expect(third[0]).toEqual(GREEN)
    expect(third[7]).toEqual(WHITE)
    expect(third[5 * 8 + 3]).toEqual(GREEN)
    expect(third[5 * 8 + 4]).toEqual(WHITE)
  })

  it('loops forever when asked, and plays once otherwise', () => {
    const make = (loop: boolean) => {
      const gif = gifWriter({ width: 2, height: 2, frameRate: 10, loop })
      gif.add(frame(2, 2, () => RED))
      gif.add(frame(2, 2, () => BLUE))
      return decodeGif(gif.finish())
    }
    expect(make(true).loops).toBe(0)
    expect(make(false).loops).toBeNull()
  })

  it('times frames in hundredths so a second of frames lasts a second, even at 15 fps', () => {
    const delays = (frameRate: number, count: number) => {
      const gif = gifWriter({ width: 2, height: 2, frameRate, loop: true })
      for (let i = 0; i < count; i++) gif.add(frame(2, 2, () => (i % 2 ? RED : BLUE)))
      return decodeGif(gif.finish()).frames.map((f) => f.delay)
    }
    expect(delays(10, 3)).toEqual([10, 10, 10])
    expect(delays(20, 3)).toEqual([5, 5, 5])
    const fifteen = delays(15, 15)
    expect(fifteen.reduce((a, b) => a + b)).toBe(100)
    expect(fifteen.every((d) => d === 6 || d === 7)).toBe(true)
  })

  it('keeps a picture with more than 256 colours to 256', () => {
    const gif = gifWriter({ width: 32, height: 32, frameRate: 10, loop: true })
    gif.add(frame(32, 32, (x, y) => [x * 8, y * 8, (x + y) * 4]))
    const [only] = decodeGif(gif.finish()).frames
    expect(new Set(only.pixels.map(String)).size).toBeLessThanOrEqual(256)
    expect(new Set(only.pixels.map(String)).size).toBeGreaterThan(64)
  })
})
