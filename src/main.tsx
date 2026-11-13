import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { UpdateBanner } from './components/UpdateBanner'
import { hasWebCodecs } from './lib/webcodecs'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App webCodecs={hasWebCodecs()} />
    <UpdateBanner />
  </StrictMode>,
)
