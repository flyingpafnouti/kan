import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { lastProject } from './lib/router'
import './index.css'
import './lib/theme'

// Reopen the last project when the app starts without an explicit route.
if (!location.hash || location.hash === '#') {
  const last = lastProject()
  if (last) history.replaceState(null, '', `#/p/${last}`)
}

// Alt + ← / → move issues between columns: never let them go back or forward in the browser history.
addEventListener('keydown', (e) => {
  if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) e.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
