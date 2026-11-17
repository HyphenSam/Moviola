// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpdateBanner } from './UpdateBanner'

const updateServiceWorker = vi.fn(async () => {})
// What the banner registered with: vite-plugin-pwa calls `onNeedReload` once the new version takes
// control, whichever tab pressed Reload.
let registered: { onNeedReload?: () => void } = {}
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: (options: typeof registered) => {
    registered = options
    return { needRefresh: [true, () => {}], updateServiceWorker }
  },
}))
const takeControl = () => act(() => registered.onNeedReload?.())

/** A page the old service worker controls, or (null) one it doesn't, such as a first visit or a hard refresh. */
function controlledBy(controller: object | null) {
  Object.defineProperty(navigator, 'serviceWorker', { value: { controller }, configurable: true })
}

const NOTHING = { running: false, undownloaded: 0 }

describe('UpdateBanner', () => {
  afterEach(() => {
    delete (navigator as { serviceWorker?: unknown }).serviceWorker
    vi.clearAllMocks()
  })

  it('hands over to the new version, which reloads the page once it takes control', async () => {
    controlledBy({})
    const reload = vi.fn()
    render(<UpdateBanner atStake={NOTHING} reload={reload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).not.toHaveBeenCalled()
  })

  it('reloads the page itself when no service worker controls it, as nothing would take control', async () => {
    controlledBy(null)
    const reload = vi.fn()
    render(<UpdateBanner atStake={NOTHING} reload={reload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('says only that a new version is ready when reloading would lose nothing', () => {
    render(<UpdateBanner atStake={NOTHING} />)
    expect(screen.getByRole('status')).toHaveTextContent(/^A new version is ready\.ReloadLater$/)
  })

  it('says what reloading would discard', () => {
    render(<UpdateBanner atStake={{ running: true, undownloaded: 2 }} />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'A new version is ready. Reloading will cancel the running job and discard 2 results you haven’t downloaded.',
    )
  })

  it('reloads a tab that would lose nothing when another tab’s Reload hands over', () => {
    const reload = vi.fn()
    render(<UpdateBanner atStake={NOTHING} reload={reload} />)
    takeControl()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('keeps a tab with something to lose open when another tab’s Reload hands over, and says so', async () => {
    const reload = vi.fn()
    render(<UpdateBanner atStake={{ running: false, undownloaded: 1 }} reload={reload} />)
    takeControl()
    expect(reload).not.toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent(
      'Moviola was updated in another tab. Reload when you’re done here.',
    )
    expect(screen.queryByRole('button', { name: 'Later' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalledOnce()
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('reloads the tab whose Reload was pressed, whatever it loses, and says it was updated if the page stays', async () => {
    controlledBy({})
    const reload = vi.fn()
    render(<UpdateBanner atStake={{ running: true, undownloaded: 0 }} reload={reload} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }))
    takeControl()
    expect(reload).toHaveBeenCalledOnce()
    // Still here: the user stayed when the browser asked.
    expect(screen.getByRole('status')).toHaveTextContent('Moviola was updated. Reload when you’re done here.')
  })
})
