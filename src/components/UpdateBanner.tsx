import { useRef, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { APP_NAME } from '@/lib/brand'
import { reloadLoss, type AtStake } from '@/lib/leaving'
import { Button } from './ui/Button'

/** Offers a reload when a new version has been downloaded in the background, saying what the reload
 * would lose (`atStake`). `reload` is for tests. */
export function UpdateBanner({
  atStake,
  reload = () => window.location.reload(),
}: {
  atStake: AtStake
  reload?: () => void
}) {
  // Read when the new version takes control, from a handler registered once.
  const stake = useRef(atStake)
  stake.current = atStake
  // Whether Reload was pressed here, rather than in another tab.
  const pressed = useRef(false)
  // The new version controls the page, but this page is still the old one: its lazily loaded chunks
  // (the encoder add-ons) may be gone, so it says so rather than let a job fail. Says where the update
  // was made.
  const [stale, setStale] = useState<'here' | 'elsewhere' | null>(null)
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    // vite-plugin-pwa calls this in every tab that saw the waiting version once it takes control, and
    // reloads them all by default. A tab whose Reload wasn't pressed reloads only if it loses nothing
    // (SPEC.md section 7). If a reload is stopped by the browser's leave prompt, the page stays stale.
    onNeedReload() {
      setStale(pressed.current ? 'here' : 'elsewhere')
      if (pressed.current || !reloadLoss(stake.current)) reload()
    },
  })
  if (!needRefresh && !stale) return null
  const loss = reloadLoss(atStake)
  return (
    <div
      role="status"
      // Above the action, which narrow screens fix to the bottom of the screen.
      className="fixed bottom-20 left-1/2 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 lg:bottom-4 items-center gap-3 rounded-panel bg-panel py-2 pr-2 pl-4 text-[13px] shadow-float ring-1 ring-line"
    >
      {stale ? (
        <>
          <p>
            {APP_NAME} was updated{stale === 'elsewhere' && ' in another tab'}. Reload when you’re done here.
          </p>
          <Button size="sm" variant="primary" onClick={reload}>
            Reload
          </Button>
        </>
      ) : (
        <>
          <p>
            A new version is ready.
            {loss && ` ${loss}`}
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              pressed.current = true
              await updateServiceWorker(true)
              // vite-plugin-pwa reloads once the new version takes control of the page, which never
              // happens on a page no service worker controls (a first visit, a hard refresh); reload it here.
              if (!navigator.serviceWorker?.controller) reload()
            }}
          >
            Reload
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
            Later
          </Button>
        </>
      )}
    </div>
  )
}
