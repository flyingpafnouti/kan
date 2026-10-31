import { uuid } from './id'
import { supabase } from './supabase'

/*
 * Images of the notes. The files live in a private Storage bucket and the Markdown only holds their path,
 * as `![image](note-image:<user id>/<uuid>.webp)`, so the database and the local cache stay light.
 */
const BUCKET = 'note-images'
const CACHE = 'note-images'
const SCHEME = 'note-image:'
/** Longest side once compressed: enough to read a screenshot. */
const MAX_SIDE = 1600
const QUALITY = 0.8
/** Same limit as the bucket (migration 007). */
const MAX_BYTES = 2 * 1024 * 1024
/** Bitmaps only: an SVG can carry scripts, and it never goes through the canvas. */
const ACCEPTED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/bmp'])

const PATH = /^note-image:([0-9a-f-]+\/[0-9a-f-]+\.(?:webp|jpg))$/i
const LINK = /!\[[^\]]*\]\(note-image:[^)\s]+\)/g

/** Path in the bucket of a Markdown image source, or null when it is not a note image. */
export function imagePath(src: string) {
  return src.match(PATH)?.[1] ?? null
}

/** The text without its images, for what shows it as plain text. */
export function stripImages(text: string) {
  return text.replace(LINK, '').replace(/\n{3,}/g, '\n\n').trim()
}

/** Sets the display width of an image, kept in its link as `![image|480](…)`; null gives back the natural size. */
export function setImageWidth(text: string, path: string, width: number | null) {
  return text.replace(LINK, (link) =>
    link.endsWith(`:${path})`) ? `![image${width ? `|${width}` : ''}](${SCHEME}${path})` : link,
  )
}

export function imageLinks(text: string) {
  return text.match(LINK) ?? []
}

export function removeImageLink(text: string, link: string) {
  return text.split(link).join('').replace(/\n{3,}/g, '\n\n').trim()
}

/** Image files of a paste or a drop. */
export function imageFiles(data: DataTransfer | null) {
  return [...(data?.files ?? [])].filter((f) => ACCEPTED.has(f.type))
}

/** Encoded through a canvas, which also drops the metadata (a photo's GPS position). */
async function compress(file: File) {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = Object.assign(document.createElement('canvas'), {
    width: Math.round(bitmap.width * scale),
    height: Math.round(bitmap.height * scale),
  })
  const context = canvas.getContext('2d')!
  const encode = (type: string) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY))
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  let blob = await encode('image/webp')
  // Safari has no WebP encoder and answers with a PNG. JPEG has no transparency: white instead of black.
  if (blob?.type !== 'image/webp') {
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = 'white'
    context.fillRect(0, 0, canvas.width, canvas.height)
    blob = await encode('image/jpeg')
  }
  bitmap.close()
  if (!blob) throw new Error('Image encoding failed')
  if (blob.size > MAX_BYTES) throw new Error('Image too large')
  return blob
}

/** Object URL by path, kept for the session. */
const urls = new Map<string, Promise<string>>()
/** Those already resolved: a text rendered again shows its images at once, without a blank frame. */
const ready = new Map<string, string>()

export const readyImageUrl = (path: string) => ready.get(path)

const cacheKey = (path: string) => `/${CACHE}/${path}`

async function openCache() {
  // Missing outside secure contexts, such as the dev server opened from the phone.
  return 'caches' in window ? caches.open(CACHE).catch(() => null) : null
}

async function fetchImage(path: string) {
  const cache = await openCache()
  const cached = await cache?.match(cacheKey(path))
  if (cached) return URL.createObjectURL(await cached.blob())
  const { data, error } = await supabase.storage.from(BUCKET).download(path)
  if (error) throw error
  // A path never changes content, so this copy stays valid and also serves offline.
  await cache?.put(cacheKey(path), new Response(data)).catch(() => {})
  return URL.createObjectURL(data)
}

/** Displayable URL of a stored image. */
export function imageUrl(path: string) {
  let url = urls.get(path)
  if (!url) {
    url = fetchImage(path)
    urls.set(path, url)
    url.then((u) => ready.set(path, u)).catch(() => urls.delete(path))
  }
  return url
}

/**
 * Compresses the file and gives its Markdown link, already displayable, and the upload to run.
 * The link must not be saved before `send` resolves.
 */
export async function prepareImage(file: File) {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user.id
  if (!user) throw new Error('No session')
  const blob = await compress(file)
  const path = `${user}/${uuid()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`
  const local = URL.createObjectURL(blob)
  urls.set(path, Promise.resolve(local))
  ready.set(path, local)
  return {
    link: `![image](${SCHEME}${path})`,
    send: async () => {
      const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: blob.type })
      if (error) {
        urls.delete(path)
        ready.delete(path)
        URL.revokeObjectURL(local)
        throw error
      }
      const cache = await openCache()
      await cache?.put(cacheKey(path), new Response(blob)).catch(() => {})
    },
  }
}

/** Forgets the images on this device, on sign out. */
export async function clearImages() {
  urls.clear()
  ready.clear()
  if ('caches' in window) await caches.delete(CACHE).catch(() => {})
}

/** Swaps the image links for tokens: a rewriting model could alter or drop them, and only needs the text. */
export function maskImages(text: string) {
  const links: string[] = []
  return { text: text.replace(LINK, (link) => `[[image-${links.push(link)}]]`), links }
}

/** Puts the links back in the rewritten text; those the model dropped go at the end. */
export function unmaskImages(text: string, links: string[]) {
  return links.reduce((out, link, i) => {
    const token = `[[image-${i + 1}]]`
    return out.includes(token) ? out.replace(token, () => link) : `${out.trimEnd()}\n\n${link}`
  }, text)
}
