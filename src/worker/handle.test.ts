import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plan } from '@/lib/plan'
import type { Reply, Request } from '@/lib/protocol'
import { CANT_OPEN } from '@/media/probe'
import { CANCELLED } from '@/media/run'
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

  it('answers a capabilities request with what can be encoded; Node has no encoders or canvas but runs WebAssembly', async () => {
    const replies: Reply[] = []
    await handle({ type: 'capabilities', id: 8 }, (reply) => replies.push(reply))
    expect(replies).toEqual([
      {
        type: 'done',
        id: 8,
        value: {
          encodeVideo: { avc: false, hevc: false, vp9: false, av1: false },
          encodeAudio: { aac: true, opus: false, mp3: true, flac: true },
          encodeWebp: false,
        },
      },
    ])
  })

  it('answers which video codecs can be encoded at a size; none in Node', async () => {
    const replies: Reply[] = []
    await handle({ type: 'encodable', id: 9, size: { width: 1280, height: 720 } }, (reply) => replies.push(reply))
    expect(replies).toEqual([{ type: 'done', id: 9, value: { avc: false, hevc: false, vp9: false, av1: false } }])
  })

  it.each([
    [3, 2],
    [2, 2],
    [1.99, 0],
    [0, 0],
    [3.96, 2],
  ])('answers a keyframe request at %s s in h264-aac.mp4 with the keyframe at %s s', async (time, keyframe) => {
    const replies: Reply[] = []
    await handle({ type: 'keyframe', id: 9, file: fixture('h264-aac.mp4'), trackId: 1, time }, (r) => replies.push(r))
    expect(replies).toEqual([{ type: 'done', id: 9, value: keyframe }])
  })

  it('counts keyframe times from the playhead’s 0 when the file starts late (MPEG-TS)', async () => {
    const replies: Reply[] = []
    const file = fixture('h264-aac.ts')
    await handle({ type: 'keyframe', id: 10, file, trackId: 256, time: 3 }, (r) => replies.push(r))
    const value = (replies[0] as { value: number }).value
    // The keyframes are 2 s apart from the first frame, which can sit a little after the start.
    expect(value).toBeGreaterThanOrEqual(2)
    expect(value).toBeLessThan(2.1)
  })

  it('answers a keyframe request for a track that isn’t there with null', async () => {
    const replies: Reply[] = []
    await handle({ type: 'keyframe', id: 11, file: fixture('h264-aac.mp4'), trackId: 99, time: 3 }, (r) =>
      replies.push(r),
    )
    expect(replies).toEqual([{ type: 'done', id: 11, value: null }])
  })

  it.each(['aac.m4a', 'h264-aac.mp4'])(
    'answers thumbnails with none when there’s no video it can decode (%s; Node has no decoder)',
    async (name) => {
      const replies: Reply[] = []
      await handle({ type: 'thumbnails', id: 12, file: fixture(name), times: [0.5, 1.5], height: 48 }, (r) =>
        replies.push(r),
      )
      expect(replies).toEqual([{ type: 'done', id: 12, value: [] }])
    },
  )

  it('ignores a cancel for a job that isn’t running', async () => {
    const replies: Reply[] = []
    await handle({ type: 'cancel', id: 99 }, (reply) => replies.push(reply))
    expect(replies).toEqual([])
  })
})

const m4a: Plan = {
  kind: 'audio',
  container: 'mp4',
  name: 'h264-aac.m4a',
  mimeType: 'audio/mp4',
  lossless: true,
  keep: [2],
}

/** Sends requests as the page does; `post` collects the worker's replies. */
function worker() {
  const replies: Reply[] = []
  return { replies, send: (request: Request) => handle(request, (reply) => replies.push(reply)) }
}

/** A file the user chose in the save dialog: an empty file until the stream is closed. */
function fakeHandle() {
  const state = { closed: false, aborted: false, removed: false, bytes: 0 }
  const handle = {
    name: 'chosen.m4a',
    createWritable: async () =>
      new WritableStream<{ data: Uint8Array }>({
        write: ({ data }) => void (state.bytes += data.byteLength),
        close: () => void (state.closed = true),
        abort: () => void (state.aborted = true),
      }),
    getFile: async () => new File(state.closed ? [new Uint8Array(state.bytes)] : [], 'chosen.m4a'),
    remove: async () => void (state.removed = true),
  }
  return { handle: handle as unknown as FileSystemFileHandle, state }
}

describe('worker handle, run', () => {
  it('builds the output in memory and answers with a Blob of the plan’s type, after progress', async () => {
    const { replies, send } = worker()
    await send({ type: 'run', id: 3, file: fixture('h264-aac.mp4'), plan: m4a, target: { type: 'memory' } })
    expect(replies[0]).toEqual({ type: 'progress', id: 3, fraction: null })
    const fractions = replies.filter((r) => r.type === 'progress').map((r) => r.fraction)
    expect(fractions.at(-1)).toBe(1)
    const done = replies.at(-1)
    expect(done).toMatchObject({ type: 'done', id: 3, value: { size: expect.any(Number) } })
    const { size, blob } = (done as { value: { size: number; blob: Blob } }).value
    expect(blob.type).toBe('audio/mp4')
    expect(blob.size).toBe(size)
  })

  it('streams into the file the user chose and keeps it', async () => {
    const { replies, send } = worker()
    const { handle, state } = fakeHandle()
    await send({ type: 'run', id: 4, file: fixture('h264-aac.mp4'), plan: m4a, target: { type: 'file', handle } })
    expect(replies.at(-1)).toEqual({ type: 'done', id: 4, value: { size: state.bytes, blob: null } })
    expect(state).toMatchObject({ closed: true, aborted: false, removed: false })
  })

  it('stops when cancelled, discarding the stream and the empty file the save dialog made', async () => {
    const { replies, send } = worker()
    const { handle, state } = fakeHandle()
    const running = send({
      type: 'run',
      id: 5,
      file: fixture('h264-aac.mp4'),
      plan: m4a,
      target: { type: 'file', handle },
    })
    await send({ type: 'cancel', id: 5 })
    await running
    expect(replies.at(-1)).toEqual({ type: 'failed', id: 5, message: CANCELLED })
    expect(state).toMatchObject({ closed: false, aborted: true, removed: true })
  })

  it('words an unexpected failure as one, keeping Mediabunny’s message', async () => {
    const { replies, send } = worker()
    await send({ type: 'run', id: 6, file: fixture('notvideo.txt'), plan: m4a, target: { type: 'memory' } })
    expect(replies.at(-1)).toMatchObject({
      type: 'failed',
      id: 6,
      message: expect.stringMatching(/^Something went wrong: ./),
    })
  })

  it('passes a problem worded for the user on as it is', async () => {
    const { replies, send } = worker()
    const webm: Plan = { ...m4a, container: 'webm', name: 'x.webm', mimeType: 'video/webm', keep: [1] }
    await send({ type: 'run', id: 7, file: fixture('h264-aac.mp4'), plan: webm, target: { type: 'memory' } })
    expect(replies.at(-1)).toEqual({
      type: 'failed',
      id: 7,
      message: 'WebM can’t hold this H.264 video without re-encoding it.',
    })
  })
})
