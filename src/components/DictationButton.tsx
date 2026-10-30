import type { ReactNode } from 'react'
import type { useDictation } from '../hooks/useDictation'
import { MicIcon, StopIcon } from './icons'

/**
 * Discreet mic, with the input level beside it while recording unless the page shows it elsewhere.
 * Children sit right before the mic.
 */
export function DictationButton({
  dictation,
  label,
  meter = true,
  children,
}: {
  dictation: ReturnType<typeof useDictation>
  label: string
  meter?: boolean
  children?: ReactNode
}) {
  const recording = dictation.state === 'recording'
  return (
    <div className="flex items-center gap-1">
      {meter && recording && (
        <div className="mr-1 h-1 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div ref={dictation.meter} className="h-full origin-left scale-x-0 rounded-full bg-red-500/70" />
        </div>
      )}
      {children}
      <button
        type="button"
        aria-label={recording ? 'Stop dictation' : label}
        title={recording ? 'Stop dictation' : label}
        onClick={dictation.toggle}
        disabled={dictation.state === 'starting' || dictation.state === 'transcribing'}
        className={`-mr-1 rounded-full p-1.5 transition ${
          recording
            ? 'animate-pulse text-red-500'
            : 'text-neutral-300 hover:text-neutral-500 disabled:opacity-40 dark:text-neutral-600 dark:hover:text-neutral-400'
        }`}
      >
        {recording ? <StopIcon width={16} height={16} /> : <MicIcon width={16} height={16} />}
      </button>
    </div>
  )
}
