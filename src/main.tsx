import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { lastProject } from './lib/router'
import './index.css'

// Reopen the last project when the app starts without an explicit route.
if (!location.hash || location.hash === '#') {
  const last = lastProject()
  if (last) history.replaceState(null, '', `#/p/${last}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
