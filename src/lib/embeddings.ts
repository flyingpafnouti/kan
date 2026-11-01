import { VECTOR_DB as DB } from './desktopSearch'
import { stripImages } from './images'

/**
 * The model leaves memory after this long without use. It holds about 1.4 GB, and WebAssembly memory never shrinks, so
 * ending the worker is the only way to free it. Its files stay in the browser's cache: it comes back in about 2 s.
 */
const IDLE_MS = 60 * 1000
const BATCH = 8
/** The model reads about 128 tokens of a text, so a long one is cut into overlapping pieces. */
const CHUNK = 500
const OVERLAP = 80
const MAX_CHUNKS = 12
const STORE = 'vectors'
/** Held by the tab that runs the model, so two tabs never load it side by side. */
const LOCK = 'search-model'
const MEANING_KEY = 'search-by-meaning'

class ModelBusyError extends Error {}

interface Entry {
  id: string
  /** Hash of the text the vectors came from. */
  hash: number
  /** One vector after the other. */
  vectors: Float32Array
}

export interface Embeddable {
  id: string
  title: string
  body: string
}

export type IndexState =
  | { phase: 'idle' }
  | { phase: 'download'; percent: number }
  | { phase: 'index'; done: number; total: number }
  | { phase: 'busy' }
  | { phase: 'failed' }

let worker: Worker | null = null
let idle: ReturnType<typeof setTimeout> | undefined
let nextId = 0
const waiting = new Map<number, { resolve: (r: { vectors: Float32Array; size: number }) => void; reject: (e: Error) => void }>()

let store: Map<string, Entry> | null = null
let size = 0
let running = false
/** Moves on when the model is stopped, which tells a running index to give up. */
let generation = 0
let releaseLock: (() => void) | null = null
let locking: Promise<boolean> | null = null
let queued: Embeddable[] | null = null
let state: IndexState = { phase: 'idle' }
const listeners = new Set<() => void>()

function setState(next: IndexState) {
  state = next
  listeners.forEach((listener) => listener())
}

export const indexState = () => state

export function watchIndex(listener: () => void) {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** Search by meaning is opt-in, and remembered on this device: it never hides results, unlike the sparkle for Groq. */
export function loadMeaning() {
  try {
    return localStorage.getItem(MEANING_KEY) === 'on'
  } catch {
    return false
  }
}

export function saveMeaning(on: boolean) {
  try {
    localStorage.setItem(MEANING_KEY, on ? 'on' : 'off')
  } catch {
    /* storage unavailable: the choice lasts until the search closes */
  }
}

function stopWorker() {
  worker?.terminate()
  worker = null
  waiting.forEach(({ reject }) => reject(new Error('Model stopped')))
  waiting.clear()
  releaseLock?.()
  releaseLock = null
}

/** Frees the model at once and drops any index in progress. */
export function stopModel() {
  generation++
  queued = null
  clearTimeout(idle)
  stopWorker()
  if (state.phase !== 'idle') setState({ phase: 'idle' })
}

/** True when this tab holds the model. The browser frees the lock if the tab closes. */
function acquireModel() {
  // Without HTTPS there are no locks: the LAN dev server, never production.
  if (releaseLock || !navigator.locks) return Promise.resolve(true)
  locking ??= new Promise<boolean>((resolve) => {
    void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
      locking = null
      if (!lock) return resolve(false)
      return new Promise<void>((free) => {
        releaseLock = free
        resolve(true)
      })
    })
  })
  return locking
}

function getWorker() {
  clearTimeout(idle)
  if (!worker) {
    worker = new Worker(new URL('../workers/embed.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      if ('progress' in data) {
        setState({ phase: 'download', percent: Math.round(data.progress) })
        return
      }
      if (state.phase === 'download') setState({ phase: 'idle' })
      const request = waiting.get(data.id)
      waiting.delete(data.id)
      if (data.error) request?.reject(new Error(data.error))
      else request?.resolve(data)
    }
    worker.onerror = stopWorker
  }
  return worker
}

/** Embeds texts in the worker, loading the model if needed. */
async function embed(texts: string[]) {
  if (!(await acquireModel())) {
    setState({ phase: 'busy' })
    throw new ModelBusyError()
  }
  if (state.phase === 'busy') setState({ phase: 'idle' })
  const target = getWorker()
  const id = nextId++
  try {
    return await new Promise<{ vectors: Float32Array; size: number }>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      target.postMessage({ id, texts })
    })
  } finally {
    clearTimeout(idle)
    idle = setTimeout(stopWorker, IDLE_MS)
  }
}

export async function embedQuery(text: string) {
  const result = await embed([text])
  size = result.size
  return result.vectors
}

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function done(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = tx.onabort = () => reject(tx.error)
  })
}

async function readStore() {
  const db = await openDb()
  try {
    const request = db.transaction(STORE).objectStore(STORE).getAll()
    const rows = await new Promise<Entry[]>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    return new Map(rows.map((row) => [row.id, row]))
  } finally {
    db.close()
  }
}

async function write(entries: Entry[], removed: string[] = []) {
  const db = await openDb()
  try {
    const tx = db.transaction(STORE, 'readwrite')
    entries.forEach((entry) => tx.objectStore(STORE).put(entry))
    removed.forEach((id) => tx.objectStore(STORE).delete(id))
    await done(tx)
  } finally {
    db.close()
  }
}

/** FNV-1a. */
function hashOf(text: string) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

export function chunksOf({ title, body }: Embeddable) {
  const head = title.replace(/\s+/g, ' ').trim().slice(0, 200)
  const rest = stripImages(body).replace(/\s+/g, ' ').trim()
  if (!rest) return [head]
  const chunks: string[] = []
  for (let at = 0; at < rest.length && chunks.length < MAX_CHUNKS; at += CHUNK - OVERLAP) {
    chunks.push(`${head}. ${rest.slice(at, at + CHUNK)}`)
  }
  return chunks
}

async function run(items: Embeddable[], turn: number) {
  store ??= await readStore()
  const known = new Set(items.map((item) => item.id))
  const stale = items.length ? [...store.keys()].filter((id) => !known.has(id)) : []
  stale.forEach((id) => store!.delete(id))
  if (stale.length) await write([], stale)

  const pieces = items.map((item) => {
    const chunks = chunksOf(item)
    return { id: item.id, chunks, hash: hashOf(chunks.join('\n')) }
  })
  const missing = pieces.filter((piece) => store!.get(piece.id)?.hash !== piece.hash)
  if (!missing.length) return
  setState({ phase: 'index', done: 0, total: missing.length })
  let index = 0
  for (const piece of missing) {
    const started = performance.now()
    const parts: Float32Array[] = []
    for (let at = 0; at < piece.chunks.length; at += BATCH) {
      const result = await embed(piece.chunks.slice(at, at + BATCH))
      size = result.size
      parts.push(result.vectors)
    }
    const vectors = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
    let offset = 0
    for (const part of parts) {
      vectors.set(part, offset)
      offset += part.length
    }
    if (turn !== generation) return
    const entry = { id: piece.id, hash: piece.hash, vectors }
    store!.set(piece.id, entry)
    await write([entry])
    index++
    // Results improve while the index fills, without a redraw per item.
    if (index % 10 === 0 || index === missing.length) setState({ phase: 'index', done: index, total: missing.length })
    // Half of one core: slower, but the fans stay quiet on the first index.
    await new Promise((resolve) => setTimeout(resolve, performance.now() - started))
    if (turn !== generation) return
  }
}

/** Brings the vectors in line with the items: new or edited ones are embedded, deleted ones forgotten. */
export async function syncIndex(items: Embeddable[]) {
  if (running) {
    queued = items
    return
  }
  running = true
  const turn = generation
  try {
    await run(items, turn)
    if (turn === generation) setState({ phase: 'idle' })
  } catch (e) {
    if (turn === generation) setState({ phase: e instanceof ModelBusyError ? 'busy' : 'failed' })
  } finally {
    running = false
    const next = queued
    queued = null
    if (next) void syncIndex(next)
  }
}

/** Cosine of each item with the query: its best piece. Vectors are normalized, so this is a dot product. */
export function similarities(query: Float32Array) {
  const scores = new Map<string, number>()
  if (!store || !size) return scores
  for (const { id, vectors } of store.values()) {
    let best = -1
    for (let at = 0; at < vectors.length; at += size) {
      let dot = 0
      for (let k = 0; k < size; k++) dot += vectors[at + k] * query[k]
      if (dot > best) best = dot
    }
    scores.set(id, best)
  }
  return scores
}
