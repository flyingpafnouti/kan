import { useEffect } from 'react'
import { DESKTOP_SEARCH_QUERY, isAndroid } from '../lib/desktopSearch'
import { useMediaQuery } from './useMediaQuery'

/** Whether this device gets the hybrid search. Its code is fetched ahead, so the first "/" does not lose keystrokes. */
export function useDesktopSearch() {
  const match = useMediaQuery(DESKTOP_SEARCH_QUERY)
  const allowed = match && !isAndroid()
  useEffect(() => {
    if (allowed) void import('../components/GlobalSearch')
  }, [allowed])
  return allowed
}
