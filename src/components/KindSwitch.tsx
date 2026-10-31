import { NOTE_KINDS, type NoteKind } from '../lib/types'
import { Switch } from './Switch'

/** Small Pro / Perso switch, for the notes shown on the page and for the type of a note. */
export function KindSwitch({ value, onChange }: { value: NoteKind; onChange: (kind: NoteKind) => void }) {
  return <Switch label="Note type" options={NOTE_KINDS} value={value} onChange={onChange} />
}
