import { describe, expect, it } from 'vitest'
import { encoderLoader } from './encoders'
import { JobProblem } from './run'

/** Add-ons whose loading the test controls: `loads` counts imports, `registered` the encoders set up. */
function setup(native = false) {
  const state = { loads: 0, registered: 0, offline: false }
  const load = async () => {
    state.loads++
    if (state.offline) throw new TypeError('Failed to fetch dynamically imported module: /assets/mp3-abc.js')
    return () => void state.registered++
  }
  const ensure = encoderLoader(async () => native, { mp3: load, flac: load, aac: load })
  return { state, ensure }
}

describe('encoderLoader', () => {
  it('loads and registers an add-on once, however many jobs need it', async () => {
    const { state, ensure } = setup()
    await Promise.all([ensure('mp3'), ensure('mp3')])
    await ensure('mp3')
    expect(state).toMatchObject({ loads: 1, registered: 1 })
  })

  it('loads nothing for a codec the browser encodes itself, or one with no add-on', async () => {
    const { state, ensure } = setup(true)
    await ensure('aac')
    const none = setup()
    await none.ensure('pcm-s16')
    await none.ensure('opus')
    expect(state.loads + none.state.loads).toBe(0)
  })

  it('words a failed load for the user, and tries again for the next job', async () => {
    const { state, ensure } = setup()
    state.offline = true
    const failed = ensure('mp3')
    await expect(failed).rejects.toBeInstanceOf(JobProblem)
    await expect(failed).rejects.toThrow(
      'The MP3 encoder couldn’t be loaded. Check your connection, or reload the page if Moviola was updated.',
    )
    await expect(ensure('flac')).rejects.toThrow('The FLAC encoder couldn’t be loaded.')

    state.offline = false
    await ensure('mp3')
    expect(state).toMatchObject({ loads: 3, registered: 1 })
  })
})
