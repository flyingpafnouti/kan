import { useEffect, useState } from 'react'
import { onChange, pendingCount } from '../lib/outbox'

export function useSyncStatus() {
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(pendingCount)
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    addEventListener('online', up)
    addEventListener('offline', down)
    const off = onChange(() => setPending(pendingCount()))
    return () => {
      removeEventListener('online', up)
      removeEventListener('offline', down)
      off()
    }
  }, [])
  return { online, pending }
}
