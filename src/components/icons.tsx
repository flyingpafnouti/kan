import type { SVGProps } from 'react'

const base = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

type P = SVGProps<SVGSVGElement>

export const PlusIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const BackIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m15 18-6-6 6-6" />
  </svg>
)

export const MoreIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </svg>
)

export const SendIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

export const ChevronIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m9 18 6-6-6-6" />
  </svg>
)

export const DownloadIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
  </svg>
)

export const MicIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
)

export const SparkleIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m11 4 1.8 5.2L18 11l-5.2 1.8L11 18l-1.8-5.2L4 11l5.2-1.8L11 4ZM19 16v4M17 18h4" />
  </svg>
)

export const StopIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" />
  </svg>
)

export const SunIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </svg>
)

export const SearchIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const GripIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20 10 10 20M20 16l-4 4" />
  </svg>
)

export const KeyboardIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="2" y="6" width="20" height="12" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8" />
  </svg>
)
