import { useSyncStatus } from '../hooks/useSyncStatus'

/** Discreet indicator, hidden when online with nothing pending. */
export function SyncBadge() {
  const { online, pending } = useSyncStatus()
  if (online && !pending) return null
  const label = !online
    ? pending
      ? `Hors ligne · ${pending} en attente`
      : 'Hors ligne'
    : 'Synchronisation…'
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-neutral-200/70 px-2.5 py-1 text-xs text-neutral-500 dark:bg-neutral-800">
      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'animate-pulse bg-accent' : 'bg-neutral-400'}`} />
      {label}
    </span>
  )
}
