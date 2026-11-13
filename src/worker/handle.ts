import type { Reply, Request } from '@/lib/protocol'
import { probe } from '@/media/probe'

/** Runs one request and posts its replies. Kept apart from the worker's global scope so Node tests
 * can call it directly. */
export async function handle(request: Request, post: (reply: Reply) => void): Promise<void> {
  try {
    switch (request.type) {
      case 'probe':
        post({ type: 'done', id: request.id, value: await probe(request.file) })
        break
    }
  } catch (error) {
    post({ type: 'failed', id: request.id, message: error instanceof Error ? error.message : String(error) })
  }
}
