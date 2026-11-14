import { useRegisterSW } from 'virtual:pwa-register/react'
import { Button } from './ui/Button'

/** Offers a reload when a new version has been downloaded in the background. `reload` is for tests. */
export function UpdateBanner({ reload = () => window.location.reload() }: { reload?: () => void }) {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()
  if (!needRefresh) return null
  return (
    <div
      role="status"
      // Above the action, which narrow screens fix to the bottom of the screen.
      className="fixed bottom-20 left-1/2 z-50 flex w-max max-w-[calc(100%-2rem)] -translate-x-1/2 lg:bottom-4 items-center gap-3 rounded-panel bg-panel py-2 pr-2 pl-4 text-[13px] shadow-float ring-1 ring-line"
    >
      A new version is ready.
      <Button
        size="sm"
        variant="primary"
        onClick={async () => {
          await updateServiceWorker(true)
          // vite-plugin-pwa reloads once the new version takes control of the page, which never happens
          // on a page no service worker controls (a first visit, a hard refresh); reload it here.
          if (!navigator.serviceWorker?.controller) reload()
        }}
      >
        Reload
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setNeedRefresh(false)}>
        Later
      </Button>
    </div>
  )
}
