import { STATUSES, type Status } from '../lib/types'

export function StatusTabs({
  value,
  counts,
  onChange,
}: {
  value: Status
  counts: Record<Status, number>
  onChange: (s: Status) => void
}) {
  return (
    <div className="grid grid-cols-3 rounded-xl bg-neutral-200/60 p-1 dark:bg-neutral-900">
      {STATUSES.map(({ id, label }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`rounded-lg py-1.5 text-sm font-medium transition ${
            value === id
              ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-white'
              : 'text-neutral-500'
          }`}
        >
          {label} <span className="tabular-nums opacity-60">{counts[id]}</span>
        </button>
      ))}
    </div>
  )
}
