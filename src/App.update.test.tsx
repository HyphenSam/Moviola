// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { fakeClient, fakeFrames, fakeInfo } from './lib/testing'

// A new version is waiting.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({ needRefresh: [true, () => {}], updateServiceWorker: async () => {} }),
}))

describe('The update banner', () => {
  it('says what reloading would lose: the running job, then the result until it’s downloaded', async () => {
    const client = fakeClient((file) => ({ ...fakeInfo(), name: file.name }))
    const user = userEvent.setup()
    render(<App webCodecs client={client} frames={fakeFrames()} />)
    const banner = () => screen.getByText(/A new version is ready/)
    expect(banner()).toHaveTextContent(/^A new version is ready\.$/)

    await user.upload(screen.getByLabelText('Choose file'), new File([new Uint8Array(16)], 'holiday.mp4'))
    await screen.findByRole('region', { name: 'Open file' })
    await user.click(
      within(screen.getByRole('radiogroup', { name: 'Tools' })).getByRole('radio', { name: 'Extract audio' }),
    )
    await user.click(screen.getByRole('button', { name: 'Extract' }))
    expect(banner()).toHaveTextContent('Reloading will cancel the running job.')

    await act(async () => client.jobs[0].finish({ size: 1, blob: new Blob(['x']) }))
    expect(banner()).toHaveTextContent('Reloading will discard 1 result you haven’t downloaded.')

    const link = within(screen.getByRole('region', { name: 'Exports' })).getByRole('link', { name: 'Download' })
    link.addEventListener('click', (e) => e.preventDefault())
    await user.click(link)
    expect(banner()).toHaveTextContent(/^A new version is ready\.$/)
  })
})
