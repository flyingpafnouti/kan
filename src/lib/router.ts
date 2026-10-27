import { useEffect, useState } from 'react'

export type Route =
  | { name: 'projects' }
  | { name: 'notes' }
  | { name: 'all' }
  | { name: 'board'; projectId: string }
  | { name: 'join'; token: string }

function parse(hash: string): Route {
  if (hash.startsWith('#/all')) return { name: 'all' }
  if (hash.startsWith('#/notes')) return { name: 'notes' }
  const join = hash.match(/^#\/join\/([\w-]+)/)
  if (join) return { name: 'join', token: join[1] }
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

export function href(route: Route): string {
  if (route.name === 'board') return `#/p/${route.projectId}`
  if (route.name === 'join') return `#/join/${route.token}`
  return route.name === 'projects' ? '#/' : `#/${route.name}`
}

export function navigate(route: Route) {
  location.hash = href(route)
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
