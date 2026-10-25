import { useEffect, useState } from 'react'

export type Route = { name: 'projects' } | { name: 'board'; projectId: string }

function parse(hash: string): Route {
  const m = hash.match(/^#\/p\/([\w-]+)/)
  return m ? { name: 'board', projectId: m[1] } : { name: 'projects' }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash))
    addEventListener('hashchange', onChange)
    return () => removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export function navigate(route: Route) {
  location.hash = route.name === 'board' ? `#/p/${route.projectId}` : '#/'
}

const LAST_KEY = 'last-project'

export function rememberProject(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_KEY, id)
    else localStorage.removeItem(LAST_KEY)
  } catch {
    /* storage unavailable */
  }
}

export function lastProject(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}
