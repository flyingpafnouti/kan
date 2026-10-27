import { useEffect, useState } from 'react'

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Projects',
    keys: [
      ['← →', 'Projects / Notes'],
      ['↑ ↓', 'Select a project'],
      ['Enter', 'Open'],
    ],
  },
  {
    title: 'Notes',
    keys: [
      ['↑ ↓', 'Select a note'],
      ['Enter', 'Open the note'],
      ['Letter', 'New note'],
      ['Esc', 'Close'],
    ],
  },
  {
    title: 'Board',
    keys: [
      ['↑ ↓ ← →', 'Select an issue'],
      ['Enter', 'Open the issue'],
      ['Alt ↑ ↓', 'Move the issue up / down'],
      ['Alt ← →', 'Change the status'],
      ['Letter', 'New issue'],
      ['/', 'Search'],
      ['Esc ⌫', 'Deselect, then back to projects'],
    ],
  },
  {
    title: 'Issue',
    keys: [
      ['Alt ↑ ↓', 'Previous / next issue'],
      ['Alt ← →', 'Change the status'],
      ['Esc', 'Close'],
    ],
  },
]

/** Discreet keyboard cheat sheet for the home pages, toggled by its link or "?". */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (!typing && e.key === '?') setOpen((v) => !v)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="mt-10 text-xs text-neutral-400">
      <button onClick={() => setOpen((v) => !v)} className="hover:text-neutral-600 dark:hover:text-neutral-300">
        Keyboard shortcuts <kbd className="ml-1 font-sans">?</kbd>
      </button>
      {open && (
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          {SECTIONS.map(({ title, keys }) => (
            <dl key={title}>
              <dt className="mb-1.5 font-medium text-neutral-500">{title}</dt>
              {keys.map(([key, label]) => (
                <dd key={key + label} className="flex gap-2 py-0.5">
                  <kbd className="w-16 shrink-0 font-sans text-neutral-500">{key}</kbd>
                  <span>{label}</span>
                </dd>
              ))}
            </dl>
          ))}
        </div>
      )}
    </div>
  )
}
