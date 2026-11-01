import { useMemo, useState } from 'react'
import { useHybridSearch } from '../hooks/useHybridSearch'
import { useIssues } from '../hooks/useIssues'
import { issueFromNote, useNotes } from '../hooks/useNotes'
import { useProjectList } from '../hooks/useProjects'
import { loadMeaning, saveMeaning } from '../lib/embeddings'
import { storeNotesView } from '../lib/notesView'
import { navigate, setPendingOpen } from '../lib/router'
import { stripImages } from '../lib/images'
import { NOTE_KINDS, PRIORITIES, type Issue, type Note, type NoteKind } from '../lib/types'
import { Palette } from './SearchPalette'
import { StatusIcon } from './StatusIcon'

interface Base {
  id: string
  title: string
  body: string
  created_at: string
  updated_at: string
  done: boolean
}

export type GlobalHit =
  | (Base & { type: 'issue'; issue: Issue })
  | (Base & { type: 'note'; note: Note })
  | (Base & { type: 'project' })

/** What a page searches: its own content, and everything from the list of projects. */
export type SearchScope =
  | { kind: 'all' }
  | { kind: 'issues' }
  | { kind: 'project'; id: string }
  | { kind: 'notes'; view: NoteKind }

const inScope = (hit: GlobalHit, scope: SearchScope) => {
  if (scope.kind === 'all') return true
  if (scope.kind === 'issues') return hit.type === 'issue'
  if (scope.kind === 'project') return hit.type === 'issue' && hit.issue.project_id === scope.id
  return hit.type === 'note' && (hit.note.kind ?? 'pro') === scope.view
}

const NOUNS = { all: 'projects, issues and notes', issues: 'all issues', project: 'this project' }

/**
 * Hybrid search over `scope`. Everything is loaded whatever the scope: the index of meaning covers all of it, or a
 * search on one page would forget the vectors of the others. `openHere` opens a hit that belongs to the current page
 * and returns true; any other hit brings its own page along.
 */
export function GlobalSearch({
  scope,
  openHere,
  onClose,
}: {
  scope: SearchScope
  openHere: (hit: GlobalHit) => boolean
  onClose: () => void
}) {
  const { issues } = useIssues(null)
  const { notes } = useNotes()
  const projects = useProjectList()
  const [query, setQuery] = useState('')
  const [meaning, setMeaning] = useState(loadMeaning)

  const all = useMemo(() => {
    if (!issues || !notes) return null
    const fromIssues = issues.map(
      (issue): GlobalHit => ({
        id: issue.id,
        title: issue.title,
        body: issue.body,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        done: issue.status === 'done',
        type: 'issue',
        issue,
      }),
    )
    const fromNotes = notes.map(
      (note): GlobalHit => ({
        ...issueFromNote(stripImages(note.body)),
        id: note.id,
        created_at: note.created_at,
        updated_at: note.updated_at,
        done: false,
        type: 'note',
        note,
      }),
    )
    const fromProjects = (projects ?? []).map(
      (project): GlobalHit => ({
        id: project.id,
        title: project.name,
        body: '',
        created_at: project.created_at,
        updated_at: project.updated_at ?? project.created_at,
        done: false,
        type: 'project',
      }),
    )
    return [...fromProjects, ...fromIssues, ...fromNotes]
  }, [issues, notes, projects])

  const items = useMemo(() => all?.filter((item) => inScope(item, scope)) ?? [], [all, scope])
  const open = useMemo(() => items.filter((item) => item.type === 'issue' && !item.done), [items])
  const { hits, status } = useHybridSearch(all, items, query, meaning)

  function pick(hit: GlobalHit) {
    onClose()
    if (openHere(hit)) return
    if (hit.type === 'project') return navigate({ name: 'board', projectId: hit.id })
    setPendingOpen(hit.id)
    if (hit.type === 'issue') navigate({ name: 'board', projectId: hit.issue.project_id })
    else {
      storeNotesView(hit.note.kind ?? 'pro')
      navigate({ name: 'notes' })
    }
  }

  return (
    <Palette
      items={items}
      nouns={scope.kind === 'notes' ? `${scope.view} notes` : NOUNS[scope.kind]}
      onPick={pick}
      onClose={onClose}
      onQuery={setQuery}
      ranked={hits}
      status={status}
      smartItems={open}
      meaning={meaning}
      onMeaning={(on) => {
        saveMeaning(on)
        setMeaning(on)
      }}
      icon={(hit) => hit.type === 'issue' && <StatusIcon status={hit.issue.status} size={16} />}
      muted={(hit) => hit.done}
      // Notes never go to Groq, so the notes page has no sparkle for it.
      describe={
        scope.kind === 'notes'
          ? undefined
          : (hit) =>
              hit.type === 'issue'
                ? [hit.issue.status, PRIORITIES.find((p) => p.id === hit.issue.priority)?.label].filter(Boolean).join(' ')
                : ''
      }
      badge={(hit) => (
        <span className="mt-0.5 max-w-32 shrink-0 truncate text-xs text-neutral-400">
          {hit.type === 'project'
            ? 'Project'
            : hit.type === 'note'
              ? `Note ${NOTE_KINDS.find((k) => k.id === (hit.note.kind ?? 'pro'))?.label}`
              : projects?.find((p) => p.id === hit.issue.project_id)?.name}
        </span>
      )}
    />
  )
}
