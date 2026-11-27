import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Plan } from '@/lib/plan'
import type { Reply, Request } from '@/lib/protocol'
import { CANT_OPEN } from '@/media/probe'
import { CANCELLED } from '@/media/run'
import { handle, SAME_FILE, UNREADABLE } from './handle'

const fixture = (name: string) => new File([readFileSync(join(import.meta.dirname, '../../fixtures', name))], name)

/** A file that was moved, deleted or changed after it was opened: it still has its name and size,
 * and every read fails as the browser's does. */
function unreadable(name: string, error = 'NotReadableError') {
  const fail = () => new DOMException('The requested file could not be read.', error)
  const spoil = <B extends Blob>(blob: B): B => {
    const slice = blob.slice.bind(blob)
    blob.slice = (...args) => spoil(slice(...args))
    blob.arrayBuffer = () => Promise.reject(fail())
    blob.bytes = () => Promise.reject(fail())
    blob.text = () => Promise.reject(fail())
    // Chrome's streams don't say why: a read through one fails with this instead (Chrome 156).
    blob.stream = () => new ReadableStream({ pull: (controller) => controller.error(new TypeError('network error')) })
    return blob
  }
  return spoil(fixture(name))
}

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

  it('answers how a video track’s frames change size', async () => {
    const replies: Reply[] = []
    await handle({ type: 'sizes', id: 13, file: fixture('vp9-resize.webm'), trackId: 1 }, (r) => replies.push(r))
    expect(replies).toEqual([
      {
        type: 'done',
        id: 13,
        value: { smallest: { width: 160, height: 90 }, largest: { width: 320, height: 180 }, changes: 2 },
      },
    ])
  })

  it('stops looking for size changes when cancelled, answering with a failure the page ignores', async () => {
    const { replies, send } = worker()
    const scanning = send({ type: 'sizes', id: 14, file: fixture('vp9-resize.webm'), trackId: 1 })
    await send({ type: 'cancel', id: 14 })
    await scanning
    expect(replies).toEqual([{ type: 'failed', id: 14, message: expect.any(String) }])
  })

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

/** A file the user chose in the save dialog: an empty file until the stream is closed, or `existing`,
 * a file that was already there and that the user chose to replace. */
function fakeHandle(existing?: File) {
  const state = { opened: false, closed: false, aborted: false, removed: false, bytes: 0 }
  const name = existing?.name ?? 'chosen.m4a'
  const handle = {
    name,
    createWritable: async () => {
      state.opened = true
      return new WritableStream<{ data: Uint8Array }>({
        write: ({ data }) => void (state.bytes += data.byteLength),
        close: () => void (state.closed = true),
        abort: () => void (state.aborted = true),
      })
    },
    getFile: async () =>
      state.closed ? new File([new Uint8Array(state.bytes)], name) : (existing ?? new File([], name)),
    remove: async () => void (state.removed = true),
  }
  return { handle: handle as unknown as FileSystemFileHandle, state }
}

/** The same file on disk, read again: another `File` object with the same name, size and date. */
const reread = (file: File) => new File([file], file.name, { lastModified: file.lastModified })

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

  it('refuses to save over the file that’s open, before anything is written or removed', async () => {
    const { replies, send } = worker()
    const file = fixture('h264-aac.mp4')
    const { handle, state } = fakeHandle(reread(file))
    await send({ type: 'run', id: 8, file, plan: m4a, target: { type: 'file', handle } })
    expect(replies.at(-1)).toEqual({ type: 'failed', id: 8, message: SAME_FILE })
    expect(state).toMatchObject({ opened: false, removed: false })
  })

  it.each([
    ['another name', (f: File) => new File([f], 'other.mp4', { lastModified: f.lastModified })],
    ['another size', (f: File) => new File([f, 'more'], f.name, { lastModified: f.lastModified })],
    ['another date', (f: File) => new File([f], f.name, { lastModified: f.lastModified - 1000 })],
  ])('replaces a file the user chose that isn’t the one open (%s)', async (_, other) => {
    const { replies, send } = worker()
    const file = fixture('h264-aac.mp4')
    const { handle, state } = fakeHandle(other(file))
    await send({ type: 'run', id: 9, file, plan: m4a, target: { type: 'file', handle } })
    expect(replies.at(-1)).toEqual({ type: 'done', id: 9, value: { size: state.bytes, blob: null } })
    expect(state).toMatchObject({ closed: true, removed: false })
  })

  it.each(['NotReadableError', 'NotFoundError'])(
    'says the source can’t be read any more when a job’s reads fail with %s',
    async (error) => {
      const { replies, send } = worker()
      const { handle, state } = fakeHandle()
      const file = unreadable('h264-aac.mp4', error)
      await send({ type: 'run', id: 10, file, plan: m4a, target: { type: 'memory' } })
      await send({ type: 'run', id: 11, file, plan: m4a, target: { type: 'file', handle } })
      expect(replies.filter((r) => r.type === 'failed')).toEqual([
        { type: 'failed', id: 10, message: UNREADABLE },
        { type: 'failed', id: 11, message: UNREADABLE },
      ])
      // The empty file the save dialog made goes, as for any job that wrote nothing.
      expect(state).toMatchObject({ closed: false, removed: true })
    },
  )

  it('says the same for a probe, a keyframe and thumbnails of a file that can’t be read any more', async () => {
    const { replies, send } = worker()
    const file = unreadable('h264-aac.mp4')
    await send({ type: 'probe', id: 12, file })
    await send({ type: 'keyframe', id: 13, file, trackId: 1, time: 3 })
    await send({ type: 'thumbnails', id: 14, file, times: [0.5], height: 48 })
    expect(replies).toEqual([12, 13, 14].map((id) => ({ type: 'failed', id, message: UNREADABLE })))
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
    const webm: Plan = { ...m4a, kind: 'video', container: 'webm', name: 'x.webm', mimeType: 'video/webm', keep: [1] }
    await send({ type: 'run', id: 7, file: fixture('h264-aac.mp4'), plan: webm, target: { type: 'memory' } })
    expect(replies.at(-1)).toEqual({
      type: 'failed',
      id: 7,
      message: 'WebM can’t hold this H.264 video without re-encoding it.',
    })
  })
})
