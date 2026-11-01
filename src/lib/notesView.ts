import type { NoteKind } from './types'

const VIEW_KEY = 'notes-view'

/** Type of notes shown, kept on this device. */
export function storedNotesView(): NoteKind {
  try {
    return localStorage.getItem(VIEW_KEY) === 'perso' ? 'perso' : 'pro'
  } catch {
    return 'pro'
  }
}

export function storeNotesView(kind: NoteKind) {
  try {
    localStorage.setItem(VIEW_KEY, kind)
  } catch {
    /* storage unavailable: the choice lasts until the page closes */
  }
}
