/** The parts of `localStorage` used here, so tests can pass a fake. */
type Store = Pick<Storage, 'getItem' | 'setItem'>

const VOLUME_KEY = 'moviola.volume'
const DEFAULT_VOLUME = 0.5

// Storage can be missing or throw (private windows, blocked site data), so every access is guarded
// and a failure just means the default.

/** The player volume the user last chose, 0 to 1; half the first time. */
export function readVolume(storage: Store | null): number {
  try {
    const raw = storage?.getItem(VOLUME_KEY)
    const volume = raw ? Number(raw) : NaN
    return volume >= 0 && volume <= 1 ? volume : DEFAULT_VOLUME
  } catch {
    return DEFAULT_VOLUME
  }
}

export function writeVolume(storage: Store | null, volume: number) {
  try {
    storage?.setItem(VOLUME_KEY, String(volume))
  } catch {
    // Not remembered this time; the player still uses it.
  }
}

const MUTED_KEY = 'moviola.muted'

/** Whether the user last left the player muted; off the first time. */
export function readMuted(storage: Store | null): boolean {
  try {
    return storage?.getItem(MUTED_KEY) === 'true'
  } catch {
    return false
  }
}

export function writeMuted(storage: Store | null, muted: boolean) {
  try {
    storage?.setItem(MUTED_KEY, String(muted))
  } catch {
    // As for the volume.
  }
}
