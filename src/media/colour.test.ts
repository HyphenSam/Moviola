import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import { describe, expect, it } from 'vitest'
import { decodeAsPlayed } from './colour'

const track = async (name: string) => {
  const file = new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  return (await input.getPrimaryVideoTrack())!
}

describe('decodeAsPlayed', () => {
  it('decodes untagged SD H.264 as BT.601, keeping the rest of the config', async () => {
    const t = await track('h264-aac-2audio.mkv')
    const before = (await t.getDecoderConfig())!
    expect(before.colorSpace?.matrix).toBeFalsy()
    await decodeAsPlayed(t)
    const after = (await t.getDecoderConfig())!
    expect(after.colorSpace).toEqual({
      primaries: 'smpte170m',
      transfer: 'smpte170m',
      matrix: 'smpte170m',
      fullRange: false,
    })
    expect({ ...after, colorSpace: undefined }).toEqual({ ...before, colorSpace: undefined })
  })

  it('decodes untagged VP9 as BT.709', async () => {
    const t = await track('vp9-opus.webm')
    await decodeAsPlayed(t)
    expect((await t.getDecoderConfig())!.colorSpace).toMatchObject({ matrix: 'bt709', primaries: 'bt709' })
  })
})
