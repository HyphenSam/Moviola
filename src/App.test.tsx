// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { App } from './App'

const TOOLS = [
  'Extract audio',
  'Media info',
  'Trim',
  'Change container',
  'Remove audio',
  'Compress',
  'Grab frame',
  'Make GIF',
]

const video = (name = 'holiday.mp4') => new File([new Uint8Array(16)], name, { type: 'video/mp4' })
const tools = () => within(screen.getByRole('radiogroup', { name: 'Tools' })).getAllByRole('radio')

describe('App', () => {
  it('shows all eight tools, disabled until a file is open', () => {
    render(<App webCodecs />)
    expect(tools().map((t) => t.textContent)).toEqual(TOOLS)
    for (const tool of tools()) expect(tool).toBeDisabled()
  })

  it('invites a video on the stage and says nothing is uploaded', () => {
    render(<App webCodecs />)
    expect(screen.getByText('Drop a video here')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose file' })).toBeInTheDocument()
    expect(screen.getByText(/nothing is uploaded/i)).toBeInTheDocument()
  })

  it('accepts a file chosen with the picker and enables the tools', async () => {
    const user = userEvent.setup()
    render(<App webCodecs />)
    const input = screen.getByLabelText('Choose file')
    expect(input).toHaveAttribute('accept', expect.stringContaining('.mkv'))
    await user.upload(input, video())

    expect(screen.getAllByText('holiday.mp4').length).toBeGreaterThan(0)
    expect(screen.queryByText('Drop a video here')).not.toBeInTheDocument()
    for (const tool of tools()) expect(tool).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Media info' })).toBeChecked()
  })

  it('accepts a file dropped anywhere on the window, whatever its extension', () => {
    render(<App webCodecs />)
    const file = new File(['x'], 'clip.weird')
    fireEvent.drop(window, { dataTransfer: { files: [file], types: ['Files'] } })
    expect(screen.getAllByText('clip.weird').length).toBeGreaterThan(0)
    for (const tool of tools()) expect(tool).toBeEnabled()
  })

  it('picks another tool when one is clicked', async () => {
    const user = userEvent.setup()
    render(<App webCodecs />)
    await user.upload(screen.getByLabelText('Choose file'), video())
    await user.click(screen.getByRole('radio', { name: 'Trim' }))
    expect(screen.getByRole('radio', { name: 'Trim' })).toBeChecked()
    expect(screen.getByRole('heading', { name: 'Trim' })).toBeInTheDocument()
  })

  it('says the browser is too old when it has no WebCodecs, and offers nothing else', () => {
    render(<App webCodecs={false} />)
    expect(screen.getByText(/This browser is too old/)).toBeInTheDocument()
    expect(screen.getByText(/Chrome or Edge 94, Firefox 130 or Safari 16\.4/)).toBeInTheDocument()
    expect(screen.queryByText('Drop a video here')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Choose file' })).not.toBeInTheDocument()

    fireEvent.drop(window, { dataTransfer: { files: [video()], types: ['Files'] } })
    expect(screen.queryByText('holiday.mp4')).not.toBeInTheDocument()
  })

  it('credits Mediabunny and the encoder libraries in About', async () => {
    const user = userEvent.setup()
    render(<App webCodecs />)
    await user.click(screen.getByRole('button', { name: 'About' }))
    const about = screen.getByRole('dialog')
    for (const name of ['Mediabunny', 'LAME', 'libFLAC', 'FFmpeg', 'gifenc']) {
      expect(within(about).getByRole('link', { name: new RegExp(name) })).toBeInTheDocument()
    }
  })
})
