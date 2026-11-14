/// <reference lib="webworker" />
import type { Request } from '@/lib/protocol'
import { registerGpuScaler } from '@/media/gpu-scaler'
import { handle } from './handle'

declare const self: DedicatedWorkerGlobalScope

registerGpuScaler()

self.addEventListener('message', (event: MessageEvent<Request>) => {
  void handle(event.data, (reply, transfer = []) => self.postMessage(reply, transfer))
})
