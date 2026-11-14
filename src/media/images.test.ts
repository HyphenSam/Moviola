import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { grabFrame } from './images'

const fixture = (name: string) => new File([readFileSync(new URL(`../../fixtures/${name}`, import.meta.url))], name)

const frame = { kind: 'frame', time: 0, mimeType: 'image/png', quality: undefined } as never

// Node has no VideoDecoder, so these reach the checks a browser would make before drawing a frame.
describe('image jobs refuse what they can’t draw', () => {
  it('names the codec this browser can’t decode', async () => {
    await expect(grabFrame(fixture('h264-aac.mp4'), frame)).rejects.toThrow('This browser can’t decode H.264 video.')
  })

  it('says when there is no video at all', async () => {
    await expect(grabFrame(fixture('aac.m4a'), frame)).rejects.toThrow('This file has no video.')
  })
})
