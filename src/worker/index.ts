/// <reference lib="webworker" />
import type { Request } from '@/lib/protocol'
import { handle } from './handle'

declare const self: DedicatedWorkerGlobalScope

self.addEventListener('message', (event: MessageEvent<Request>) => {
  void handle(event.data, (reply) => self.postMessage(reply))
})
