import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

if (typeof window !== 'undefined') {
  const { cleanup } = await import('@testing-library/react')
  afterEach(cleanup)

  // jsdom has no layout, so nothing to observe.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom can't play media or draw. Playing and pausing fire their events, as a browser does once the
  // state changes; drawing does nothing.
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: false, configurable: true })
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { value: true, configurable: true })
    this.dispatchEvent(new Event('pause'))
  }
  HTMLMediaElement.prototype.load = () => {}
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext

  let urls = 0
  URL.createObjectURL ??= () => `blob:test/${++urls}`
  URL.revokeObjectURL ??= () => {}
}
