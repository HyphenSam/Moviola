import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Reply } from '@/lib/protocol'
import { CANT_OPEN } from '@/media/probe'
import { handle } from './handle'

const fixture = (name: string) => new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)

async function run(file: File) {
  const replies: Reply[] = []
  await handle({ type: 'probe', id: 7, file }, (reply) => replies.push(reply))
  return replies
}

describe('worker handle', () => {
  it('answers a probe with the file’s info', async () => {
    const [reply] = await run(fixture('h264-aac.mp4'))
    expect(reply).toMatchObject({ type: 'done', id: 7, value: { name: 'h264-aac.mp4', container: 'mp4' } })
  })

  it('answers a probe of something that isn’t media with the sentence the user sees', async () => {
    expect(await run(fixture('notvideo.txt'))).toEqual([{ type: 'failed', id: 7, message: CANT_OPEN }])
  })
})
