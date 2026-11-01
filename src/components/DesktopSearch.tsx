import { Suspense, lazy, type ComponentProps } from 'react'
import type { GlobalSearch as Search } from './GlobalSearch'

const GlobalSearch = lazy(() => import('./GlobalSearch').then((module) => ({ default: module.GlobalSearch })))

/** Loads the hybrid search on demand: its code must never reach a phone. */
export function DesktopSearch(props: ComponentProps<typeof Search>) {
  return (
    <Suspense fallback={null}>
      <GlobalSearch {...props} />
    </Suspense>
  )
}
