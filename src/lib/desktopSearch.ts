/** Database of the embeddings. Named here so signing out can drop it without loading the search code. */
export const VECTOR_DB = 'search-vectors-v1'

/** The hybrid search is for computers only: a wide screen with a mouse, and never Android, whatever its accessories. */
export const DESKTOP_SEARCH_QUERY = '(min-width: 768px) and (pointer: fine)'

export const isAndroid = () => /android/i.test(navigator.userAgent)

export function dropVectors() {
  return new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(VECTOR_DB)
    request.onsuccess = request.onerror = request.onblocked = () => resolve()
  })
}
