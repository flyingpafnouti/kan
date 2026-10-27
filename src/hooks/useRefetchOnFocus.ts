import { useEffect } from 'react'

/**
 * Reload when the app comes back: phone woke up, tab switched, window focused again, network back.
 * On a desktop the window often stays "visible" while the user works elsewhere, so focus counts too: it catches
 * up when realtime has dropped without notice.
 */
export function useRefetchOnFocus(load: () => void) {
  useEffect(() => {
    const visible = () => document.visibilityState === 'visible'
    const onVisible = () => visible() && load()
    document.addEventListener('visibilitychange', onVisible)
    addEventListener('focus', onVisible)
    addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      removeEventListener('focus', onVisible)
      removeEventListener('online', onVisible)
    }
  }, [load])
}

/** subscribe() callback that reloads after the channel rejoins, to fetch what changed while it was down. */
export function reloadOnRejoin(load: () => void) {
  let joined = false
  return (status: string) => {
    if (status !== 'SUBSCRIBED') return
    if (joined) load()
    joined = true
  }
}
