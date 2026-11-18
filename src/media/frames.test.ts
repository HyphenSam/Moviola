import { describe, expect, it, vi } from 'vitest'
import { bitmapsOf } from './frames'

const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap & { close: () => void }

describe('bitmapsOf', () => {
  it('makes a bitmap of each canvas, and null where there was none', async () => {
    async function* canvases() {
      yield { canvas: 'a' }
      yield null
    }
    const made = bitmap()
    expect(await bitmapsOf(canvases(), async () => made)).toEqual([made, null])
  })

  it('closes the bitmaps made so far when decoding fails part-way', async () => {
    async function* canvases() {
      yield { canvas: 'a' }
      yield { canvas: 'b' }
      throw new Error('Decoding failed.')
    }
    const made: ReturnType<typeof bitmap>[] = []
    const make = async () => {
      made.push(bitmap())
      return made.at(-1)!
    }
    await expect(bitmapsOf(canvases(), make)).rejects.toThrow('Decoding failed.')
    expect(made).toHaveLength(2)
    for (const b of made) expect(b.close).toHaveBeenCalled()
  })
})
