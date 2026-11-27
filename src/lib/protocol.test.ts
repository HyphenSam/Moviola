import { describe, expect, it } from 'vitest'
import { createClient, WORKER_STOPPED, type Port, type Reply, type Request } from './protocol'
import type { Plan } from './plan'
import { fakeInfo } from './testing'

const plan: Plan = { kind: 'audio', container: 'mp4', name: 'a.m4a', mimeType: 'audio/mp4', lossless: true, keep: [2] }

/** A worker stand-in: records what was posted and lets the test reply. */
function fakePort() {
  const sent: Request[] = []
  const listeners: Record<string, (e: { data: Reply }) => void> = {}
  const port: Port = {
    postMessage: (message) => sent.push(message),
    addEventListener: (type: string, fn: (e: { data: Reply }) => void) => void (listeners[type] = fn),
  }
  return {
    port,
    sent,
    reply: (data: Reply) => listeners.message?.({ data }),
    /** The worker fails: its script didn't load, it died, or a message couldn't be read. */
    fail: (type: 'error' | 'messageerror' = 'error') => listeners[type]?.({} as { data: Reply }),
  }
}

describe('createClient', () => {
  it('posts a probe request with the file and resolves with the info the worker sends back', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const file = new File(['x'], 'a.mp4')
    const info = fakeInfo()
    const result = client.probe(file)
    expect(sent).toEqual([{ type: 'probe', id: 1, file }])
    reply({ type: 'done', id: 1, value: info })
    await expect(result).resolves.toBe(info)
  })

  it('asks the worker what it can encode', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const result = client.capabilities()
    expect(sent).toEqual([{ type: 'capabilities', id: 1 }])
    const value = { encodeVideo: { avc: true }, encodeAudio: { mp3: true } }
    reply({ type: 'done', id: 1, value })
    await expect(result).resolves.toEqual(value)
  })

  it('asks which video codecs can be encoded at a size', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const result = client.encodable({ width: 720, height: 1280 })
    expect(sent).toEqual([{ type: 'encodable', id: 1, size: { width: 720, height: 1280 } }])
    reply({ type: 'done', id: 1, value: { avc: true, hevc: false } })
    await expect(result).resolves.toEqual({ avc: true, hevc: false })
  })

  it('asks for the keyframe at or before a time in a track, and resolves with its time', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const file = new File(['x'], 'a.mp4')
    const result = client.keyframe(file, 1, 3)
    expect(sent).toEqual([{ type: 'keyframe', id: 1, file, trackId: 1, time: 3 }])
    reply({ type: 'done', id: 1, value: 2 })
    await expect(result).resolves.toBe(2)
  })

  it('asks for thumbnails at times and a height, and resolves with the images', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const file = new File(['x'], 'a.mp4')
    const result = client.thumbnails(file, [0.5, 1.5], 48)
    expect(sent).toEqual([{ type: 'thumbnails', id: 1, file, times: [0.5, 1.5], height: 48 }])
    reply({ type: 'done', id: 1, value: [] })
    await expect(result).resolves.toEqual([])
  })

  it('asks how a video track’s frames change size, and cancels that by its id', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const file = new File(['x'], 'a.webm')
    const scan = client.sizeChanges(file, 1)
    expect(sent).toEqual([{ type: 'sizes', id: 1, file, trackId: 1 }])
    const value = { smallest: { width: 960, height: 1 }, largest: { width: 960, height: 720 }, changes: 90 }
    reply({ type: 'done', id: 1, value })
    await expect(scan.result).resolves.toEqual(value)

    client.sizeChanges(file, 1).cancel()
    expect(sent.at(-1)).toEqual({ type: 'cancel', id: 2 })
  })

  it('rejects with the worker’s message when it fails', async () => {
    const { port, reply } = fakePort()
    const client = createClient(port)
    const result = client.probe(new File(['x'], 'a.txt'))
    reply({ type: 'failed', id: 1, message: 'Moviola can’t open this file.' })
    await expect(result).rejects.toThrow('Moviola can’t open this file.')
  })

  it('matches replies to requests by id', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const first = client.probe(new File(['1'], 'one.mp4'))
    const second = client.probe(new File(['2'], 'two.mp4'))
    expect(sent.map((r) => r.id)).toEqual([1, 2])
    reply({ type: 'done', id: 2, value: fakeInfo({ name: 'two.mp4' }) })
    reply({ type: 'done', id: 1, value: fakeInfo({ name: 'one.mp4' }) })
    expect((await first).name).toBe('one.mp4')
    expect((await second).name).toBe('two.mp4')
  })

  it('runs a plan, passing progress on and resolving with the result', async () => {
    const { port, sent, reply } = fakePort()
    const client = createClient(port)
    const file = new File(['x'], 'a.mp4')
    const progress: (number | null)[] = []
    const job = client.run(file, plan, { type: 'memory' }, (f) => progress.push(f))
    expect(sent).toEqual([{ type: 'run', id: 1, file, plan, target: { type: 'memory' } }])
    reply({ type: 'progress', id: 1, fraction: null })
    reply({ type: 'progress', id: 1, fraction: 0.5 })
    const blob = new Blob(['y'])
    reply({ type: 'done', id: 1, value: { size: 1, blob } })
    await expect(job.result).resolves.toEqual({ size: 1, blob })
    expect(progress).toEqual([null, 0.5])
  })

  it.each(['error', 'messageerror'] as const)('rejects everything pending when the worker fails (%s)', async (type) => {
    const { port, fail } = fakePort()
    const client = createClient(port)
    const probe = client.probe(new File(['x'], 'a.mp4'))
    const capabilities = client.capabilities()
    const job = client.run(new File(['x'], 'a.mp4'), plan, { type: 'memory' })
    fail(type)
    await expect(probe).rejects.toThrow(WORKER_STOPPED)
    await expect(capabilities).rejects.toThrow(WORKER_STOPPED)
    await expect(job.result).rejects.toThrow(WORKER_STOPPED)
  })

  it('rejects every later request once the worker has failed, without posting it', async () => {
    const { port, sent, fail } = fakePort()
    const client = createClient(port)
    fail()
    await expect(client.probe(new File(['x'], 'a.mp4'))).rejects.toThrow(
      'Moviola’s background worker stopped. Reload the page to carry on.',
    )
    await expect(client.encodable({ width: 1280, height: 720 })).rejects.toThrow(WORKER_STOPPED)
    const job = client.run(new File(['x'], 'a.mp4'), plan, { type: 'memory' })
    await expect(job.result).rejects.toThrow(WORKER_STOPPED)
    job.cancel()
    expect(sent).toEqual([])
  })

  it('asks the worker to cancel a run by its id', () => {
    const { port, sent } = fakePort()
    const client = createClient(port)
    client.probe(new File(['x'], 'a.mp4'))
    const job = client.run(new File(['x'], 'a.mp4'), plan, { type: 'memory' })
    job.cancel()
    expect(sent.at(-1)).toEqual({ type: 'cancel', id: 2 })
  })
})
