export type WebpAnimationOptions = { width: number; height: number; frameRate: number; loop: boolean }

const NOT_WEBP = 'The browser didn’t make a WebP frame.'

/** Writes an animated WebP (SPEC.md 6.8) from still WebPs the browser's canvas encoded: each still's
 * bitstream goes into an ANMF chunk as it is, covering the whole canvas. Nothing is re-encoded here,
 * and frames aren't diffed against each other, so every frame is whole. */
export function webpAnimationWriter({ width, height, frameRate, loop }: WebpAnimationOptions) {
  const frames: Uint8Array[] = []
  let alpha = false
  // Each frame ends where its own time rounds to, so a second of frames lasts a second (67, 66, 67…).
  const ms = (frame: number) => Math.round((frame * 1000) / frameRate)
  return {
    add(still: Uint8Array) {
      const { data, hasAlpha } = bitstream(still)
      alpha ||= hasAlpha
      const n = frames.length
      const header = [...u24(0), ...u24(0), ...u24(width - 1), ...u24(height - 1), ...u24(ms(n + 1) - ms(n))]
      // Bit 1: don't blend with the frame before; bit 0 clear: leave it in place. Frames are opaque and whole.
      frames.push(chunk('ANMF', concat([new Uint8Array([...header, 0x02]), data])))
    },
    finish(): Uint8Array {
      // VP8X flags: alpha (bit 4), animation (bit 1). Then the canvas size less one.
      const vp8x = chunk('VP8X', new Uint8Array([alpha ? 0x12 : 0x02, 0, 0, 0, ...u24(width - 1), ...u24(height - 1)]))
      // A transparent background, and the loop count: 0 is forever, 1 plays once.
      const anim = chunk('ANIM', new Uint8Array([0, 0, 0, 0, loop ? 0 : 1, 0]))
      const body = concat([ascii('WEBP'), vp8x, anim, ...frames])
      return concat([ascii('RIFF'), u32(body.length), body])
    },
  }
}

/** The chunks that draw a still WebP (ALPH if any, then VP8 or VP8L), whole with their headers and
 * padding, and whether it has alpha. Anything else (ICC profile, Exif, XMP) is left behind. */
function bitstream(still: Uint8Array): { data: Uint8Array; hasAlpha: boolean } {
  if (still.length < 12 || text(still, 0) !== 'RIFF' || text(still, 8) !== 'WEBP') throw new Error(NOT_WEBP)
  const view = new DataView(still.buffer, still.byteOffset, still.byteLength)
  const kept: Uint8Array[] = []
  let hasAlpha = false
  for (let at = 12; at + 8 <= still.length;) {
    const fourcc = text(still, at)
    const size = view.getUint32(at + 4, true)
    const end = Math.min(still.length, at + 8 + size + (size % 2))
    if (fourcc === 'VP8X') hasAlpha = (still[at + 8] & 0x10) !== 0
    if (fourcc === 'ALPH' || fourcc === 'VP8 ' || fourcc === 'VP8L') kept.push(padded(still.subarray(at, end)))
    at = end
  }
  if (!kept.some((c) => text(c, 0).startsWith('VP8'))) throw new Error(NOT_WEBP)
  return { data: concat(kept), hasAlpha }
}

const text = (bytes: Uint8Array, at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
const ascii = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255]
const u32 = (n: number) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24])

/** A chunk's bytes, with the pad byte an odd size needs (an encoder may leave it off the last chunk). */
const padded = (c: Uint8Array) => (c.length % 2 ? concat([c, new Uint8Array(1)]) : c)

const chunk = (fourcc: string, payload: Uint8Array) => padded(concat([ascii(fourcc), u32(payload.length), payload]))

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}
