import { useRef, useState } from 'react'
import { navigate } from '../lib/router'
import type { NoteKind } from '../lib/types'
import { useMediaQuery } from '../hooks/useMediaQuery'
import { useSwipe } from '../hooks/useSwipe'
import { Notes } from './Notes'
import { Projects } from './Projects'

const VIEW_KEY = 'notes-view'

/** Type of notes shown, kept on this device. */
function storedView(): NoteKind {
  try {
    return localStorage.getItem(VIEW_KEY) === 'perso' ? 'perso' : 'pro'
  } catch {
    return 'pro'
  }
}

function storeView(kind: NoteKind) {
  try {
    localStorage.setItem(VIEW_KEY, kind)
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}

/** Swipe order: projects, then each type of notes. */
const STOPS = ['projects', 'pro', 'perso'] as const

/** The two home pages: on a touch screen a horizontal swipe walks through STOPS, the header staying in place. */
export function Home({ current }: { current: 'projects' | 'notes' }) {
  const desktop = useMediaQuery('(pointer: fine)')
  const [view, setView] = useState(storedView)
  // Set by the page while a swipe would lose something: open sheet, search, project being edited, dictation.
  const [locked, setLocked] = useState(false)
  const area = useRef<HTMLDivElement>(null)
  // Attached by the page, under its header.
  const pane = useRef<HTMLDivElement>(null)

  function show(kind: NoteKind) {
    setView(kind)
    storeView(kind)
  }

  const stop = STOPS.indexOf(current === 'projects' ? 'projects' : view)
  useSwipe(area, pane, {
    enabled: !desktop && !locked,
    hasPrev: stop > 0,
    hasNext: stop < STOPS.length - 1,
    onSwipe: (dir) => {
      const target = STOPS[stop + dir]
      if (target !== 'projects') show(target)
      const page = target === 'projects' ? 'projects' : 'notes'
      if (page !== current) navigate({ name: page })
      scrollTo(0, 0)
    },
  })

  return (
    <div ref={area} className={`overflow-x-clip ${desktop ? '' : 'touch-pan-y touch-pinch-zoom'}`}>
      {current === 'notes' ? (
        <Notes view={view} onView={show} pane={pane} onLock={setLocked} />
      ) : (
        <Projects pane={pane} onLock={setLocked} />
      )}
    </div>
  )
}
