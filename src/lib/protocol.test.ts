import { describe, expect, it } from 'vitest'
import { createClient, type Port, type Reply, type Request } from './protocol'
import { fakeInfo } from './testing'

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
})
