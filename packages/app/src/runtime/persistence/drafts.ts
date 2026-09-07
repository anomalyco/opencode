import type { AsyncStorage } from "@solid-primitives/storage"
import { Option, Schema } from "effect"

export type BlobReference = { id: string; url: string }

type Driver = {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  putBlob(blob: Blob): Promise<string>
  getBlob(id: string): Promise<Blob | null>
}

export type DraftStore = AsyncStorage & {
  putBlob(blob: Blob): Promise<BlobReference>
  /** Persist an already-encoded document without re-parsing its serialized form. */
  setDocument(key: string, document: unknown): Promise<void>
}

// Strings at least this long leave the document as fixed-size content-addressed chunks. Typing
// after a large paste changes only the final chunk, so a save uploads one chunk, not the paste.
export const draftTextThreshold = 16 * 1024
export const draftTextChunk = 64 * 1024
// A cached chunk id may be republished without an upload for this long after its last use. The
// host keeps unreferenced blobs for much longer (desktop `blobGrace`) and refreshes a blob every
// time a written document references it, so a hit here always points at a retained blob.
export const draftChunkCacheTtl = 5 * 60_000
const textCacheLimit = 64

const urls = new Map<string, string>()

function blobUrl(id: string, blob: Blob) {
  const existing = urls.get(id)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  urls.set(id, url)
  return url
}

async function blobID(blob: Blob) {
  const bytes = crypto.subtle
    ? new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()))
    : crypto.getRandomValues(new Uint8Array(16))
  const id = Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
  return id
}

export async function createBlobReference(blob: Blob): Promise<BlobReference> {
  const id = await blobID(blob)
  return { id, url: blobUrl(id, blob) }
}

export function createDraftStore(driver: Driver, options: { now?: () => number } = {}): DraftStore {
  const now = options.now ?? Date.now
  const versions = new Map<string, number>()
  const loading = new Map<string, Promise<string | undefined>>()
  const loadBlobUrl = (id: string) => {
    const existing = urls.get(id)
    if (existing) return existing
    const pending = loading.get(id)
    if (pending) return pending
    const next = driver
      .getBlob(id)
      .then((blob) => (blob ? blobUrl(id, blob) : undefined))
      .finally(() => loading.delete(id))
    loading.set(id, next)
    return next
  }
  const putBlob = async (blob: Blob) => {
    const id = await driver.putBlob(blob)
    return { id, url: blobUrl(id, blob) }
  }
  // Keyed by chunk content so unchanged chunks are never hashed or sent again while the draft is
  // edited. Bounded because each entry pins up to draftTextChunk characters.
  const chunkIds = new Map<string, { id: Promise<string>; used: number }>()
  const chunks = new Map<string, string>()
  const remember = <V>(cache: Map<string, V>, key: string, value: V) => {
    cache.set(key, value)
    if (cache.size > textCacheLimit) cache.delete(cache.keys().next().value!)
    return value
  }
  const upload = (chunk: string, at: number) => {
    const id = driver.putBlob(new Blob([chunk])).then(
      (id) => {
        remember(chunks, id, chunk)
        return id
      },
      (error: unknown) => {
        // A failed upload must not be reused as the answer for this content on later saves.
        if (chunkIds.get(chunk)?.id === id) chunkIds.delete(chunk)
        throw error
      },
    )
    remember(chunkIds, chunk, { id, used: at })
    return id
  }
  const externalize = (text: string) => {
    const at = now()
    return Promise.all(
      split(text).map((chunk) => {
        const cached = chunkIds.get(chunk)
        if (!cached || at - cached.used > draftChunkCacheTtl) return upload(chunk, at)
        cached.used = at
        return cached.id
      }),
    )
  }
  const loadChunk = async (id: string) => {
    const cached = chunks.get(id)
    if (cached !== undefined) return cached
    const blob = await driver.getBlob(id)
    // A missing chunk loses that text but keeps the rest of the document decodable.
    return remember(chunks, id, blob ? await blob.text() : "")
  }
  const encode = async (value: unknown): Promise<unknown> => {
    if (typeof value === "string" && value.length >= draftTextThreshold) {
      return { blob: { kind: "text", ids: await externalize(value) } }
    }
    if (Array.isArray(value)) return Promise.all(value.map(encode))
    if (!value || typeof value !== "object") return value
    const item = value as Record<string, unknown>
    if (item.type === "image" && typeof item.dataUrl === "string") {
      const blob = await fetch(item.dataUrl).then((response) => response.blob())
      const { dataUrl: _, ...rest } = item
      return { ...rest, blob: { id: await driver.putBlob(blob) } }
    }
    if ("blob" in item && item.blob && typeof item.blob === "object") {
      const blob = item.blob as Record<string, unknown>
      if (blob.kind === "text") return item
      if (typeof blob.id === "string" && blob.id.startsWith("data:")) {
        const data = await fetch(blob.id).then((response) => response.blob())
        return { ...item, blob: { id: await driver.putBlob(data) } }
      }
      return { ...item, blob: { id: blob.id } }
    }
    return Object.fromEntries(
      await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await encode(entry)])),
    )
  }
  const decode = async (value: unknown): Promise<unknown> => {
    if (Array.isArray(value)) return Promise.all(value.map(decode))
    if (!value || typeof value !== "object") return value
    const item = value as Record<string, unknown>
    if (item.blob && typeof item.blob === "object") {
      const ref = item.blob as Record<string, unknown>
      if (ref.kind === "text" && Array.isArray(ref.ids)) {
        return (await Promise.all(ref.ids.map((id) => loadChunk(String(id))))).join("")
      }
      if (typeof ref.id === "string") {
        const url = await loadBlobUrl(ref.id)
        if (url) return { ...item, blob: { id: ref.id, url } }
      }
    }
    return Object.fromEntries(
      await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await decode(entry)])),
    )
  }
  const setDocument = async (key: string, document: unknown) => {
    const version = (versions.get(key) ?? 0) + 1
    versions.set(key, version)
    const encoded = JSON.stringify(await encode(document))
    if (versions.get(key) === version) await driver.set(key, encoded)
  }
  return {
    getItem: async (key) => {
      const value = await driver.get(key)
      if (value === null) return null
      const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value)
      // Let the owning persistence codec apply its invalid-document policy.
      if (Option.isNone(parsed)) return value
      return JSON.stringify(await decode(parsed.value))
    },
    setItem: (key, value) => setDocument(key, JSON.parse(value)),
    setDocument,
    removeItem: async (key) => {
      versions.set(key, (versions.get(key) ?? 0) + 1)
      await driver.remove(key)
    },
    putBlob,
  }
}

// Fixed-size pieces, except that a piece never ends between the two halves of a surrogate pair:
// each piece becomes its own Blob, and an unpaired surrogate would be encoded as U+FFFD.
function split(text: string) {
  const pieces: string[] = []
  for (let start = 0; start < text.length; ) {
    const end = Math.min(start + draftTextChunk, text.length)
    const code = text.charCodeAt(end - 1)
    const stop = end < text.length && code >= 0xd800 && code <= 0xdbff ? end + 1 : end
    pieces.push(text.slice(start, stop))
    start = stop
  }
  return pieces
}

export function createBrowserDraftStore(): DraftStore {
  const request = indexedDB.open("opencode-drafts", 1)
  request.addEventListener("upgradeneeded", () => {
    request.result.createObjectStore("documents")
    request.result.createObjectStore("blobs")
  })
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    request.addEventListener("success", () => {
      const database = request.result
      const transaction = database.transaction(["documents", "blobs"], "readwrite")
      const documents = transaction.objectStore("documents").getAll()
      documents.addEventListener("success", () => {
        const used = new Set<string>()
        JSON.parse(`[${documents.result.join(",")}]`, (_key, item) => {
          if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
          if (item?.blob && Array.isArray(item.blob.ids)) item.blob.ids.forEach((id: unknown) => used.add(String(id)))
          return item
        })
        const store = transaction.objectStore("blobs")
        const blobs = store.openKeyCursor()
        blobs.addEventListener("success", () => {
          const cursor = blobs.result
          if (!cursor) return
          if (!used.has(String(cursor.key))) store.delete(cursor.key)
          cursor.continue()
        })
      })
      transaction.addEventListener("complete", () => resolve(database))
      transaction.addEventListener("abort", () => resolve(database))
    })
    request.addEventListener("error", () => reject(request.error))
  })
  const get = async (store: string, key: string) => {
    const result = (await db).transaction(store).objectStore(store).get(key)
    return new Promise<unknown>((resolve, reject) => {
      result.addEventListener("success", () => resolve(result.result))
      result.addEventListener("error", () => reject(result.error))
    })
  }
  const write = async (store: string, key: string, value?: unknown) => {
    const transaction = (await db).transaction(store, "readwrite")
    if (value === undefined) transaction.objectStore(store).delete(key)
    else transaction.objectStore(store).put(value, key)
    return new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve())
      transaction.addEventListener("error", () => reject(transaction.error))
    })
  }
  return createDraftStore({
    get: async (key) => ((await get("documents", key)) as string | undefined) ?? null,
    set: (key, value) => write("documents", key, value),
    remove: (key) => write("documents", key),
    putBlob: async (blob) => {
      const id = await blobID(blob)
      await write("blobs", id, blob)
      return id
    },
    getBlob: async (id) => ((await get("blobs", id)) as Blob | undefined) ?? null,
  })
}

export async function blobDataUrl(blob: BlobReference, mime: string) {
  const data = await fetch(blob.url).then((response) => response.blob())
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("error", () => reject(reader.error))
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : ""
      resolve(`data:${mime};base64,${value.slice(value.indexOf(",") + 1)}`)
    })
    reader.readAsDataURL(data)
  })
}

export function createLegacyBlobReference(dataUrl: string): BlobReference {
  return { id: dataUrl, url: dataUrl }
}
