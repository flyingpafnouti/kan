import { forwardRef, useEffect, useRef, useState, type FormEvent } from 'react'
import { useKeyboardInset } from '../hooks/useKeyboardInset'
import { PlusIcon, SendIcon } from './icons'

/** Desktop: inline field on top of the "À faire" column, focused by typing anywhere on the board. */
export const QuickAddInline = forwardRef<HTMLInputElement, { onAdd: (title: string) => void }>(function QuickAddInline(
  { onAdd },
  ref,
) {
  const [value, setValue] = useState('')
  function submit(e: FormEvent) {
    e.preventDefault()
    const t = value.trim()
    if (t) onAdd(t)
    setValue('')
  }
  return (
    <form onSubmit={submit} className="mb-2">
      <input
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && e.currentTarget.blur()}
        placeholder="Nouvelle issue…"
        className="w-full rounded-xl border border-dashed border-neutral-300 bg-transparent px-3 py-2.5 text-[15px] outline-none focus:border-solid focus:border-accent dark:border-neutral-700"
      />
    </form>
  )
})

/**
 * Mobile: floating button that reveals a bar above the keyboard.
 * The input stays mounted so it can be focused synchronously in the tap handler (required by iOS).
 */
export function QuickAddMobile({ onAdd }: { onAdd: (title: string) => void }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const inset = useKeyboardInset()

  useEffect(() => {
    if (!open) input.current?.blur()
  }, [open])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = value.trim()
    if (t) onAdd(t)
    setValue('')
    input.current?.focus()
  }

  return (
    <>
      <button
        aria-label="Nouvelle issue"
        onClick={() => {
          setOpen(true)
          input.current?.focus()
        }}
        className={`fixed right-5 z-20 rounded-full bg-accent p-4 text-white shadow-lg shadow-accent/30 transition active:scale-95 ${
          open ? 'pointer-events-none opacity-0' : ''
        }`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 20px)' }}
      >
        <PlusIcon width={24} height={24} />
      </button>
      {open && <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />}
      <form
        onSubmit={submit}
        style={{ bottom: inset }}
        className={`fixed inset-x-0 z-30 border-t border-neutral-200 bg-neutral-50/95 px-3 pt-2 pb-safe backdrop-blur transition dark:border-neutral-800 dark:bg-neutral-950/95 ${
          open ? '' : 'pointer-events-none translate-y-full opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 pb-2">
          <input
            ref={input}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => !value.trim() && setOpen(false)}
            placeholder="Nouvelle issue"
            enterKeyHint="send"
            tabIndex={open ? 0 : -1}
            className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 outline-none ring-1 ring-neutral-200 focus:ring-accent dark:bg-neutral-900 dark:ring-neutral-800"
          />
          <button
            aria-label="Ajouter"
            onMouseDown={(e) => e.preventDefault()}
            disabled={!value.trim()}
            className="rounded-full bg-accent p-2.5 text-white transition disabled:opacity-30"
          >
            <SendIcon />
          </button>
        </div>
      </form>
    </>
  )
}
