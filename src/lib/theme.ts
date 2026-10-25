import { useEffect, useState } from 'react'

/**
 * Light / dark theme. Follows the system until the user flips the switch; the choice is then kept
 * on this device. index.html applies it before the first paint, this module keeps it in sync.
 */

export type Theme = 'light' | 'dark'

const KEY = 'theme'
const COLORS: Record<Theme, string> = { light: '#fafafa', dark: '#162137' }
const system = matchMedia('(prefers-color-scheme: dark)')

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : null
  } catch {
    return null
  }
}

/** The user's choice, null while following the system. */
let chosen = stored()

const current = (): Theme => chosen ?? (system.matches ? 'dark' : 'light')

const listeners = new Set<() => void>()

function apply() {
  const theme = current()
  document.documentElement.classList.toggle('dark', theme === 'dark')
  // Status bar of the installed app.
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', COLORS[theme]))
  listeners.forEach((l) => l())
}

system.addEventListener('change', () => {
  if (!chosen) apply()
})
apply()

export function toggleTheme() {
  chosen = current() === 'dark' ? 'light' : 'dark'
  try {
    localStorage.setItem(KEY, chosen)
  } catch {
    /* storage unavailable: the choice lasts until reload */
  }
  apply()
}

export function useTheme(): Theme {
  const [theme, setTheme] = useState(current)
  useEffect(() => {
    const l = () => setTheme(current())
    listeners.add(l)
    return () => void listeners.delete(l)
  }, [])
  return theme
}
