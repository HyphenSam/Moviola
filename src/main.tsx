import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createClient } from './lib/protocol'
import { hasWebCodecs } from './lib/webcodecs'
import { openFrames } from './media/frames'
import './index.css'

const worker = new Worker(new URL('./worker/index.ts', import.meta.url), { type: 'module' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App webCodecs={hasWebCodecs()} client={createClient(worker)} frames={openFrames} />
  </StrictMode>,
)
