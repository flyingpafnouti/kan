import { useEffect } from 'react'
import { navigate } from '../lib/router'
import { signOut } from '../lib/signOut'
import { toggleTheme, useTheme } from '../lib/theme'
import { SyncBadge } from './SyncBadge'
import { MoonIcon, SunIcon } from './icons'

type Tab = 'projects' | 'notes'

const TABS: { id: Tab; label: string; href: string }[] = [
  { id: 'projects', label: 'Projects', href: '#/' },
  { id: 'notes', label: 'Notes', href: '#/notes' },
]

/** Header of the two home pages: Projects / Notes switch (also ← / → and Tab), theme and sign out. */
export function HomeHeader({ current, keys = true }: { current: Tab; keys?: boolean }) {
  const theme = useTheme()

  useEffect(() => {
    if (!keys) return
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (typing || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return
      // Tab (or Shift + Tab) flips to the other page, outside text fields where it still moves the focus.
      const other = current === 'projects' ? 'notes' : 'projects'
      const target =
        e.key === 'Tab' ? other : e.shiftKey ? null : e.key === 'ArrowLeft' ? 'projects' : e.key === 'ArrowRight' ? 'notes' : null
      if (!target || target === current) return
      e.preventDefault()
      navigate({ name: target })
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [current, keys])

  return (
    <header className="flex items-center justify-between py-5">
      <nav className="flex items-baseline gap-4">
        {TABS.map(({ id, label, href }) => (
          <a
            key={id}
            href={href}
            aria-current={id === current ? 'page' : undefined}
            className={`text-2xl font-semibold tracking-tight transition ${
              id === current
                ? ''
                : 'text-neutral-400 hover:text-neutral-600 dark:text-neutral-600 dark:hover:text-neutral-400'
            }`}
          >
            {label}
          </a>
        ))}
      </nav>
      <div className="ml-auto mr-2">
        <SyncBadge />
      </div>
      <button
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        className="mr-1 rounded-lg p-1.5 text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        {theme === 'dark' ? <SunIcon width={18} height={18} /> : <MoonIcon width={18} height={18} />}
      </button>
      <button
        onClick={signOut}
        className="rounded-lg px-2 py-1 text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
      >
        Sign out
      </button>
    </header>
  )
}
