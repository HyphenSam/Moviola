import { describe, expect, it } from 'vitest'
import { createClient, type Port, type Reply, type Request } from './protocol'
import type { Plan } from './plan'
import { fakeInfo } from './testing'

const plan: Plan = { kind: 'audio', container: 'mp4', name: 'a.m4a', mimeType: 'audio/mp4', lossless: true, keep: [2] }

/** A worker stand-in: records what was posted and lets the test reply. */
function fakePort() {
  const sent: Request[] = []
  let listener: ((e: { data: Reply }) => void) | null = null
  const port: Port = {
    postMessage: (message) => sent.push(message),
    addEventListener: (_type, fn) => (listener = fn),
  }
  return { port, sent, reply: (data: Reply) => listener?.({ data }) }
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

  it('asks the worker to cancel a run by its id', () => {
    const { port, sent } = fakePort()
    const client = createClient(port)
    client.probe(new File(['x'], 'a.mp4'))
    const job = client.run(new File(['x'], 'a.mp4'), plan, { type: 'memory' })
    job.cancel()
    expect(sent.at(-1)).toEqual({ type: 'cancel', id: 2 })
  })
})
