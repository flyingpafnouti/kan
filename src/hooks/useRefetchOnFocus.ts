import { useEffect } from 'react'

/** Reload when the app comes back to the foreground (phone woke up, tab switched). */
export function useRefetchOnFocus(load: () => void) {
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])
}
