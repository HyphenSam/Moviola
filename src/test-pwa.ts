// Stands in for vite-plugin-pwa's `virtual:pwa-register/react` in tests (vite.config.ts): no update waits.
export const useRegisterSW = () => ({
  needRefresh: [false, () => {}],
  offlineReady: [false, () => {}],
  updateServiceWorker: async () => {},
})
