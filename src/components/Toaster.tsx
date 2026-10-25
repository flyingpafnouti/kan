import { useEffect, useState } from 'react'
import { onToast } from '../lib/toast'

export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => {
    let t: number
    const off = onToast((m) => {
      setMsg(m)
      clearTimeout(t)
      t = window.setTimeout(() => setMsg(null), 3000)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [])
  if (!msg) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center pt-safe">
      <div className="animate-fade mt-3 rounded-full bg-neutral-900 px-4 py-2 text-sm text-white shadow-lg dark:bg-neutral-100 dark:text-neutral-900">
        {msg}
      </div>
    </div>
  )
}
