import { useEffect, useRef, useState } from 'react'
import { KeyboardIcon } from './icons'

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'Projects',
    keys: [
      ['← →', 'Projects / Notes'],
      ['Tab', 'Projects / Notes'],
      ['↑ ↓', 'Select a project'],
      ['Letters', 'Jump to a project by name'],
      ['Enter', 'Open'],
    ],
  },
  {
    title: 'Notes',
    keys: [
      ['↑ ↓', 'Select a note'],
      ['Enter', 'Open the note'],
      ['/', 'Search'],
      ['Letter', 'New note'],
      ['Esc', 'Close'],
      ['Ctrl ↵', 'Close'],
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
      ['Ctrl ↵', 'Close'],
    ],
  },
]

/** Keyboard cheat sheet for the home pages: a button pinned bottom right opens it as a card, so does "?". */
export function ShortcutsHelp() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]')
      if (!typing && e.key === '?') setOpen((v) => !v)
      // Capture phase: this Escape closes the card and stops there, the page does not go back.
      else if (open && e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    addEventListener('keydown', onKey, true)
    return () => removeEventListener('keydown', onKey, true)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    addEventListener('pointerdown', onDown)
    return () => removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div ref={box} className="fixed right-6 bottom-6 z-30 flex flex-col items-end gap-3">
      {open && (
        <div className="grid w-[34rem] max-w-[calc(100vw-3rem)] animate-sheet grid-cols-2 gap-x-8 gap-y-5 rounded-2xl bg-white p-5 text-[13px] shadow-2xl ring-1 ring-neutral-200/70 dark:bg-neutral-900 dark:ring-neutral-800">
          {SECTIONS.map(({ title, keys }) => (
            <dl key={title}>
              <dt className="mb-2 text-xs font-semibold tracking-wide text-neutral-400 uppercase">{title}</dt>
              {keys.map(([key, label]) => (
                <dd key={key + label} className="flex items-baseline gap-3 py-0.5">
                  <kbd className="w-20 shrink-0 font-sans font-medium text-neutral-700 dark:text-neutral-200">{key}</kbd>
                  <span className="text-neutral-500 dark:text-neutral-400">{label}</span>
                </dd>
              ))}
            </dl>
          ))}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-white px-3.5 py-2 text-sm text-neutral-600 shadow-md ring-1 ring-neutral-200/70 transition hover:text-neutral-900 dark:bg-neutral-900 dark:text-neutral-300 dark:ring-neutral-800 dark:hover:text-white"
      >
        <KeyboardIcon width={18} height={18} />
        Shortcuts
        <kbd className="rounded bg-neutral-100 px-1.5 font-sans text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">?</kbd>
      </button>
    </div>
  )
}
