// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

const updateServiceWorker = vi.fn(async () => {})
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [true, () => {}], updateServiceWorker }),
}))

/** A page the old service worker controls, or (null) one it doesn't, such as a first visit or a hard refresh. */
function controlledBy(controller: object | null) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { controller }, configurable: true })
}

describe('UpdateBanner', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    vi.clearAllMocks()
  })

  it('hands over to the new version, which reloads the page once it takes control', async () => {
    controlledBy({})
    const reload = vi.fn()
    render(<UpdateBanner reload={reload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page itself when no service worker controls it, as nothing would take control', async () => {
    controlledBy(null)
    const reload = vi.fn()
    render(<UpdateBanner reload={reload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).toHaveBeenCalledOnce()
  })
})
