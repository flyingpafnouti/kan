import type { Status } from '../lib/types'

/** Linear-style status glyph: empty, half, checked. */
export function StatusIcon({ status, size = 18 }: { status: Status; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden>
      {status === 'todo' && (
        <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-neutral-400" />
      )}
      {status === 'doing' && (
        <g className="text-accent">
          <circle cx="9" cy="9" r="7" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M9 4.5a4.5 4.5 0 0 1 0 9z" fill="currentColor" />
        </g>
      )}
      {status === 'done' && (
        <g className="text-accent">
          <circle cx="9" cy="9" r="8" fill="currentColor" />
          <path d="m5.5 9.2 2.3 2.3 4.7-4.9" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      )}
    </svg>
  )
}
