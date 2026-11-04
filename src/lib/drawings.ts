import { BUCKET, DRAWING, encodeCanvas, prepareEncoded } from './images'
import { supabase } from './supabase'

/*
 * Drawings of the notes. Each is a note image, its preview, with its editable source beside it in the bucket:
 * `<user id>/<uuid>.webp` and `<user id>/<uuid>.json.gz`. An edit saves a new pair, so a path never changes content.
 */

/** What the editor saves: the objects of its canvas, as fabric serializes them. */
export interface DrawingData {
  v: 1
  objects: object[]
}

const sourcePath = (path: string) => path.replace(/\.(?:webp|jpg)$/i, '.json.gz')

async function gzip(text: string) {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  // Typed: the upload sends the blob's own type, and the bucket only takes application/gzip.
  return new Blob([await new Response(stream).arrayBuffer()], { type: 'application/gzip' })
}

async function gunzip(blob: Blob) {
  return new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

/** The preview's link, with its width in CSS pixels, already displayable, and the upload to run: the source first, so a shown drawing can always be edited. */
export async function prepareDrawing(preview: HTMLCanvasElement, width: number, data: DrawingData) {
  const source = await gzip(JSON.stringify(data))
  // Shown at its drawn size, the preview being encoded at a higher density.
  const image = await prepareEncoded(await encodeCanvas(preview), `${DRAWING}|${Math.round(width)}`)
  return {
    ...image,
    send: async () => {
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(sourcePath(image.path), source, { contentType: 'application/gzip' })
      if (error) throw error
      await image.send()
    },
  }
}

/** Source of a drawing, from the path of its preview. */
export async function loadDrawing(path: string): Promise<DrawingData> {
  const { data, error } = await supabase.storage.from(BUCKET).download(sourcePath(path))
  if (error) throw error
  const parsed = JSON.parse(await gunzip(data))
  if (parsed?.v !== 1 || !Array.isArray(parsed.objects)) throw new Error('Unknown drawing format')
  return parsed
}
