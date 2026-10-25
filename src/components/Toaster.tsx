import { useEffect, useState } from 'react'
import { onToast, type ToastMessage } from '../lib/toast'

export function Toaster() {
  const [current, setCurrent] = useState<ToastMessage | null>(null)

  useEffect(() => onToast(setCurrent), [])

  useEffect(() => {
    if (!current) return
    const t = window.setTimeout(() => setCurrent(null), current.duration)
    return () => clearTimeout(t)
  }, [current])

  if (!current) return null
  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 92px)' }}
    >
      <div
        key={current.id}
        className="animate-sheet pointer-events-auto relative flex items-center gap-4 overflow-hidden rounded-xl bg-neutral-900 py-2.5 pr-2.5 pl-4 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900"
      >
        <span className={current.action ? '' : 'pr-1.5'}>{current.msg}</span>
        {current.action && (
          <button
            onClick={() => {
              current.action!.run()
              setCurrent(null)
            }}
            className="rounded-lg px-2.5 py-1 font-medium text-indigo-300 hover:bg-white/10 dark:text-accent dark:hover:bg-black/5"
          >
            {current.action.label}
          </button>
        )}
        {current.action && (
          <div
            className="toast-progress absolute bottom-0 left-0 h-0.5 w-full origin-left bg-indigo-300 dark:bg-accent"
            style={{ animationDuration: `${current.duration}ms` }}
          />
        )}
      </div>
    </div>
  )
}
