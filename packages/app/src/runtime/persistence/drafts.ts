import type { AsyncStorage } from "@solid-primitives/storage"
import { Option, Schema } from "effect"
import { mediaHashFromUri } from "@/runtime/server/media"
import {
  createDraftRetentionState,
  isCurrentSave,
  RETAINED_BLOB_GRACE_MS,
  resolveBlobAlias,
  selectBlobStoreId,
  selectDocumentRevision,
  selectLatestMutation,
  selectRetainedBlob,
  transitionDraftRetention,
  type DraftRetentionEvent,
} from "./drafts-machine"

/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns, anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type, anti-slop/require-safety-comment-for-type-assertion, anti-slop/no-known-value-widening -- the store walks opaque persisted JSON in every shape earlier releases wrote, and IndexedDB hands back untyped values */

export type BlobReference = { id: string; url: string }

type Driver = {
  get(key: string): Promise<string | null>
  /**
   * Store the document and report every blob id it references that the store does not hold. A
   * strict write is refused (nothing stored) when any are missing, so a document is never visible
   * with dangling references while its blobs are being restored.
   */
  set(key: string, value: string, strict: boolean): Promise<readonly string[]>
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

const textCacheLimit = 64

export const retainedBlobGrace = RETAINED_BLOB_GRACE_MS

let retention = createDraftRetentionState()

const timers = new Map<string, ReturnType<typeof setTimeout>>()

// Fetches image bytes from the store whose documents reference them. Documents load without their
// bytes; a consumer that renders or sends an image resolves its URL through here, so a history full
// of large attachments costs nothing at startup.
const storeLoaders = new Map<number, (id: string) => Promise<string | undefined>>()

type MediaBlobLoader = (uri: string) => Promise<string | undefined>

const mediaLoaders = new Map<string, MediaBlobLoader>()

function dispatch(event: DraftRetentionEvent) {
  const result = transitionDraftRetention(retention, event)
  retention = result.state
  result.effects.forEach((effect) => {
    if (effect.type === "url.revoke") return URL.revokeObjectURL(effect.url)

    clearTimeout(timers.get(effect.id))
    timers.delete(effect.id)

    if (effect.type === "timer.cancel") return

    timers.set(
      effect.id,
      setTimeout(() => {
        timers.delete(effect.id)
        dispatch({ type: "grace.expired", id: effect.id, attempt: effect.attempt })
      }, effect.delayMs),
    )
  })
}

export function setMediaBlobLoader(key: string, next: MediaBlobLoader | undefined) {
  mediaLoaders.delete(key)

  if (next) mediaLoaders.set(key, next)
}

async function loadMediaBlobUrl(uri: string, serverKey?: string) {
  if (serverKey) {
    const keyed = mediaLoaders.get(serverKey)

    if (keyed) {
      const url = await keyed(uri).catch(() => undefined)

      if (url) return url
    }
  }

  for (const [key, candidate] of [...mediaLoaders.entries()].reverse()) {
    if (key === serverKey) continue
    const url = await candidate(uri).catch(() => undefined)

    if (url) return url
  }

  return undefined
}

// The bytes behind a `media:<hash>` ref, through the authenticated media loader; `media:` is not
// fetchable itself. Undefined once no server can serve it (swept, offline, or the flag is off).
async function loadMediaBlob(uri: string, serverKey?: string) {
  const url = await loadMediaBlobUrl(uri, serverKey).catch(() => undefined)

  if (!url) return undefined

  return fetch(url).then(
    (response) => (response.ok ? response.blob() : undefined),
    () => undefined,
  )
}

/** The object URL for an image reference, loading its bytes from the draft store on first use. */
export function resolveBlobUrl(blob: { id: string; url?: string; server?: string }) {
  if (blob.url && !mediaHashFromUri(blob.url)) return Promise.resolve(blob.url)
  const existing = selectRetainedBlob(retention, blob.id)

  if (existing) return Promise.resolve(existing.url)

  if (mediaHashFromUri(blob.id)) return loadMediaBlobUrl(blob.id, blob.server)

  if (blob.url) return Promise.resolve(blob.url)

  return storeLoaders.get(selectBlobStoreId(retention, blob.id) ?? 0)?.(blob.id) ?? Promise.resolve(undefined)
}

// Without a grace the image has no store to reference it from and stays for the page's lifetime.
function blobUrl(id: string, blob: Blob, graceMs?: number) {
  const existing = retention.blobs.get(id)

  if (existing) {
    dispatch({ type: "blob.touched", id, graceMs })

    return existing.url
  }

  const url = URL.createObjectURL(blob)
  dispatch({ type: "blob.materialized", id, blob, url, graceMs })

  return url
}

// Image ids a document references: `{ blob: { id } }` parts, not text chunk lists.
function imageIDs(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((entry) => imageIDs(entry, into))

    return into
  }

  if (!value || typeof value !== "object") return into
  const item = value as Record<string, unknown>
  const blob = item.blob

  if (blob && typeof blob === "object" && !("kind" in blob)) {
    const id = (blob as Record<string, unknown>).id

    if (typeof id === "string") into.add(id)

    return into
  }

  Object.values(item).forEach((entry) => imageIDs(entry, into))

  return into
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

export function createDraftStore(driver: Driver, options: { grace?: number } = {}): DraftStore {
  const grace = options.grace ?? retainedBlobGrace
  const storeId = retention.nextStoreId
  dispatch({ type: "store.registered" })
  const loading = new Map<string, Promise<string | undefined>>()

  const loadBlobUrl = (id: string) => {
    const existing = selectRetainedBlob(retention, id)

    if (existing) return Promise.resolve(existing.url)
    const pending = loading.get(id)

    if (pending) return pending

    const next = driver
      .getBlob(id)
      .then((blob) => (blob ? blobUrl(id, blob, grace) : undefined))
      .finally(() => loading.delete(id))

    loading.set(id, next)

    return next
  }

  storeLoaders.set(storeId, loadBlobUrl)

  const putBlob = async (blob: Blob) => {
    const id = await driver.putBlob(blob)

    return { id, url: blobUrl(id, blob, grace) }
  }

  // Keyed by chunk content so unchanged chunks are never hashed or sent again while the draft is
  // edited. Bounded because each entry pins up to draftTextChunk characters. A hit is safe even if
  // the store has since collected the blob: the write reports it missing and it is uploaded again.
  const chunkIds = new Map<string, Promise<string>>()
  const chunks = new Map<string, string>()

  const remember = <V>(cache: Map<string, V>, key: string, value: V) => {
    cache.set(key, value)

    if (cache.size > textCacheLimit) cache.delete(cache.keys().next().value!)

    return value
  }

  const upload = (chunk: string) => {
    const id = driver.putBlob(new Blob([chunk])).then(
      (id) => {
        remember(chunks, id, chunk)

        return id
      },
      (error: unknown) => {
        // A failed upload must not be reused as the answer for this content on later saves.
        if (chunkIds.get(chunk) === id) chunkIds.delete(chunk)
        throw error
      },
    )

    return remember(chunkIds, chunk, id)
  }

  const externalize = (text: string) => Promise.all(split(text).map((chunk) => chunkIds.get(chunk) ?? upload(chunk)))

  const loadChunk = async (id: string) => {
    const cached = chunks.get(id)

    if (cached !== undefined) return cached
    const blob = await driver.getBlob(id)

    // A missing chunk loses that text but keeps the rest of the document decodable.
    return remember(chunks, id, blob ? await blob.text() : "")
  }

  // `sources` collects, for every blob id the encoded document references, a way to produce its
  // bytes again: the chunk text itself, or the image Blob (or object URL) the reference carries.
  type Sources = Map<string, { blob: () => Promise<Blob>; chunk?: string }>

  // `pin` claims an image id for the running save before its bytes get an object URL.
  type Pin = (id: string) => void

  const encode = async (value: unknown, sources: Sources, pin: Pin): Promise<unknown> => {
    if (typeof value === "string" && value.length >= draftTextThreshold) {
      const pieces = split(value)
      const ids = await externalize(value)
      ids.forEach((id, index) =>
        sources.set(id, { blob: async () => new Blob([pieces[index]!]), chunk: pieces[index] }),
      )

      return { blob: { kind: "text", ids } }
    }

    if (Array.isArray(value)) return Promise.all(value.map((entry) => encode(entry, sources, pin)))

    if (!value || typeof value !== "object") return value
    const item = value as Record<string, unknown>

    if (item.type === "image" && typeof item.dataUrl === "string") {
      const blob = await fetch(item.dataUrl).then((response) => response.blob())
      const { dataUrl: _, ...rest } = item
      const id = await driver.putBlob(blob)
      sources.set(id, { blob: async () => blob })

      return { ...rest, blob: { id } }
    }

    if ("blob" in item && item.blob && typeof item.blob === "object") {
      const blob = item.blob as Record<string, unknown>

      if (blob.kind === "text") return item

      if (typeof blob.id === "string" && blob.id.startsWith("data:")) {
        const data = await fetch(blob.id).then((response) => response.blob())
        const id = await driver.putBlob(data)
        sources.set(id, { blob: async () => data })

        return { ...item, blob: { id } }
      }

      // Drafts own their bytes: the server sweeps a media blob once no message or inbox item references
      // it, so the first save copies the bytes into the draft store and later saves reuse that copy.
      if (
        typeof blob.id === "string" &&
        mediaHashFromUri(blob.id) &&
        !(retention.aliases.has(blob.id) && selectRetainedBlob(retention, blob.id))
      ) {
        const data = await loadMediaBlob(blob.id, typeof blob.server === "string" ? blob.server : undefined)

        // Nothing serves the bytes anymore; the reference is dropped on read like any blob with no bytes.
        if (!data) return { ...item, blob: { id: blob.id } }
        const id = await driver.putBlob(data)
        pin(id)
        blobUrl(id, data, grace)
        dispatch({ type: "alias.recorded", from: blob.id, to: id })
        sources.set(id, { blob: async () => data })

        return { ...item, blob: { id } }
      }

      if (typeof blob.id === "string") {
        // A live reference keeps the id it was created with; publish the id its bytes now live under.
        const id = resolveBlobAlias(retention, blob.id)
        const retained = selectRetainedBlob(retention, id)
        const kept = retained?.blob
        const url = typeof blob.url === "string" && !mediaHashFromUri(blob.url) ? blob.url : retained?.url

        if (kept) sources.set(id, { blob: async () => kept })
        else if (url) sources.set(id, { blob: () => fetch(url).then((response) => response.blob()) })

        return { ...item, blob: { id } }
      }

      return { ...item, blob: { id: blob.id } }
    }

    return Object.fromEntries(
      await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await encode(entry, sources, pin)])),
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

      // Bytes stay in the store until something renders or sends the image (see resolveBlobUrl);
      // only an image already pinned in this page gets its URL back immediately.
      if (typeof ref.id === "string") {
        const url = selectRetainedBlob(retention, ref.id)?.url

        return { ...item, blob: url ? { id: ref.id, url } : { id: ref.id } }
      }
    }

    return Object.fromEntries(
      await Promise.all(Object.entries(item).map(async ([key, entry]) => [key, await decode(entry)])),
    )
  }

  // Upload the bytes behind `ids` again and return the ids they were stored under. Ids are
  // usually content hashes and come back unchanged, but a store without WebCrypto assigns fresh
  // ones, so callers must rename references rather than assume.
  const restore = async (ids: readonly string[], sources: Sources, pin: Pin) => {
    const renamed = new Map<string, string>()
    await Promise.all(
      ids.map(async (id) => {
        const source = sources.get(id)

        if (!source) return
        const blob = await source.blob()
        const next = await driver.putBlob(blob)
        renamed.set(id, next)

        if (source.chunk !== undefined) {
          remember(chunkIds, source.chunk, Promise.resolve(next))
          remember(chunks, next, source.chunk)

          return
        }

        pin(next)
        blobUrl(next, blob, grace)
        dispatch({ type: "alias.recorded", from: id, to: next })
      }),
    )

    return renamed
  }

  const rename = (value: unknown, renamed: Map<string, string>): unknown => {
    if (Array.isArray(value)) return value.map((entry) => rename(entry, renamed))

    if (!value || typeof value !== "object") return value
    const item = value as Record<string, unknown>

    if (item.blob && typeof item.blob === "object") {
      const ref = item.blob as Record<string, unknown>

      if (Array.isArray(ref.ids))
        return { ...item, blob: { ...ref, ids: ref.ids.map((id) => renamed.get(String(id)) ?? id) } }

      if (typeof ref.id === "string") return { ...item, blob: { ...ref, id: renamed.get(ref.id) ?? ref.id } }
    }

    return Object.fromEntries(Object.entries(item).map(([key, entry]) => [key, rename(entry, renamed)]))
  }

  // The image ids the stored document now references, or undefined when a later save or remove
  // superseded this one before it wrote.
  const write = async (key: string, document: unknown, attempt: number) => {
    const pin = (id: string) =>
      dispatch({ type: "save.referenced", storeId, key, attempt, ids: new Set([id]), graceMs: grace })
    const sources: Sources = new Map()
    const encoded = await encode(document, sources, pin)

    if (!isCurrentSave(retention, storeId, key, attempt)) return undefined
    // The store refuses the write while any referenced blob is missing, so the previous document
    // stays visible until the bytes are back. Covers a blob collected while a cache, another tab,
    // or the composer's history still held its id.
    const missing = await driver.set(key, JSON.stringify(encoded), true)

    if (missing.length === 0) return imageIDs(encoded)

    const renamed = await restore(missing, sources, pin)

    if (!isCurrentSave(retention, storeId, key, attempt)) return undefined
    const unrestored = missing.filter((id) => !renamed.has(id))

    if (unrestored.length)
      console.error(`[persistence] draft ${key} references blobs with no bytes to restore`, unrestored)
    // Anything still missing has no bytes anywhere; the owning codec drops such references on read.
    const final = rename(encoded, renamed)
    await driver.set(key, JSON.stringify(final), false)

    return imageIDs(final)
  }

  const setDocument = async (key: string, document: unknown) => {
    dispatch({ type: "save.started", storeId, key, ids: imageIDs(document), graceMs: grace })
    const attempt = selectLatestMutation(retention, storeId, key)

    await write(key, document, attempt).then(
      (ids) =>
        dispatch(
          ids
            ? { type: "save.committed", storeId, key, attempt, ids, graceMs: grace }
            : { type: "save.aborted", storeId, key, attempt, graceMs: grace },
        ),
      (error: unknown) => {
        dispatch({ type: "save.aborted", storeId, key, attempt, graceMs: grace })
        throw error
      },
    )
  }

  return {
    getItem: async (key) => {
      const revision = selectDocumentRevision(retention, storeId, key)
      const value = await driver.get(key)

      if (value === null) return null
      const parsed = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(value)

      // Let the owning persistence codec apply its invalid-document policy.
      if (Option.isNone(parsed)) return value
      // A loaded document is live in the composer: pin its images before decode mints their URLs.
      dispatch({ type: "load.succeeded", storeId, key, revision, ids: imageIDs(parsed.value), graceMs: grace })

      return JSON.stringify(await decode(parsed.value))
    },
    setItem: (key, value) => setDocument(key, JSON.parse(value)),
    setDocument,
    removeItem: async (key) => {
      dispatch({ type: "remove.started", storeId, key })
      const attempt = selectLatestMutation(retention, storeId, key)
      await driver.remove(key)
      dispatch({ type: "remove.committed", storeId, key, attempt, graceMs: grace })
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
        const used = referenced(`[${documents.result.join(",")}]`)
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
    set: async (key, value, strict) => {
      // One readwrite transaction over both stores: IndexedDB serialises overlapping readwrite
      // transactions in creation order, so a later save or removal cannot commit between the
      // reference check and this write. The put is issued from the last lookup's callback so the
      // transaction is never left without a pending request.
      const ids = [...referenced(value)]
      const transaction = (await db).transaction(["blobs", "documents"], "readwrite")
      const missing: string[] = []

      const publish = () => {
        if (!strict || missing.length === 0) transaction.objectStore("documents").put(value, key)
      }

      let remaining = ids.length

      if (remaining === 0) publish()

      for (const id of ids) {
        const lookup = transaction.objectStore("blobs").getKey(id)
        lookup.addEventListener("success", () => {
          if (lookup.result === undefined) missing.push(id)

          if (--remaining === 0) publish()
        })
      }

      return new Promise<string[]>((resolve, reject) => {
        transaction.addEventListener("complete", () => resolve(missing))
        transaction.addEventListener("error", () => reject(transaction.error))
        transaction.addEventListener("abort", () => reject(transaction.error))
      })
    },
    remove: (key) => write("documents", key),
    putBlob: async (blob) => {
      const id = await blobID(blob)
      await write("blobs", id, blob)

      return id
    },
    getBlob: async (id) => ((await get("blobs", id)) as Blob | undefined) ?? null,
  })
}

// Every blob id a serialized document (or array of documents) references.
function referenced(json: string) {
  const ids = new Set<string>()
  JSON.parse(json, (_key, item) => {
    if (item?.blob && typeof item.blob.id === "string") ids.add(item.blob.id)

    if (item?.blob && Array.isArray(item.blob.ids)) item.blob.ids.forEach((id: unknown) => ids.add(String(id)))

    return item
  })

  return ids
}

// Submits always carry the bytes, so a send never depends on a server blob that may have been swept.
// A `media:` ref goes out only when no bytes are reachable here; the server still resolves it if it can.
export async function blobDataUrl(blob: BlobReference, mime: string) {
  const kept = selectRetainedBlob(retention, blob.id)
  const url = kept ? undefined : await resolveBlobUrl(blob)

  if (!kept && !url && mediaHashFromUri(blob.id)) return blob.id

  if (!kept && !url) throw new Error(`Attachment ${blob.id} has no stored bytes`)
  const data = kept ? kept.blob : await fetch(url!).then((response) => response.blob())

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

/**
 * A local copy of the bytes behind a `media:<hash>` reference, loaded through the media loader, for a draft about to
 * outlive the server's copy: cancelling an inbox item sweeps blobs nothing else references. Other references return
 * unchanged; a ref nothing serves anymore throws, so the caller can stop before dropping the last server copy.
 */
export async function pinMediaBlob(blob: BlobReference): Promise<BlobReference> {
  const ref = [blob.id, blob.url].find((uri) => mediaHashFromUri(uri))

  if (!ref) return blob
  const data = await loadMediaBlob(ref)

  if (!data) throw new Error(`Attachment ${ref} is no longer available`)

  return createBlobReference(data)
}

// A `media:<hash>` ref is no URL a renderer can load, so it keeps the empty URL a draft-store id has and resolves
// through `resolveBlobUrl`; drafts saved this way stay readable by versions that predate media refs.
export function createLegacyBlobReference(dataUrl: string): BlobReference {
  return { id: dataUrl, url: mediaHashFromUri(dataUrl) ? "" : dataUrl }
}
