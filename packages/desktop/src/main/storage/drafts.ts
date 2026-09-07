import { createHash } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import { blobs, document } from "./schema"
import { createWriteBehind } from "./write-behind"

export type DraftStore = ReturnType<typeof createDraftStore>

// Editing a large paste retires one text chunk per save, so orphans accumulate while the app runs.
const collectInterval = 60_000
// A blob stays collectable-proof for this long after its last upload or document reference. The
// renderer reuses a cached chunk id without uploading for far less than this (see
// draftChunkCacheTtl), so a reference it publishes always points at a retained blob.
export const blobGrace = 15 * 60_000

// Every blob id a document references: image parts `{ blob: { id } }` and text chunk lists
// `{ blob: { kind: "text", ids: [...] } }`. SQLite walks the JSON; nothing parses drafts in JS.
const referenced = (value: unknown) => sql`
  SELECT json_extract(node.value, '$.id') AS id
  FROM json_tree(${value}) AS node
  WHERE node.key = 'blob' AND node.type = 'object' AND json_type(node.value, '$.id') = 'text'
  UNION
  SELECT chunk.value AS id
  FROM json_tree(${value}) AS node, json_each(node.value, '$.ids') AS chunk
  WHERE node.key = 'blob' AND node.type = 'object' AND json_type(node.value, '$.ids') = 'array'
`

export function createDraftStore(
  db: Database,
  input: { delay?: number; onError?: (error: unknown) => void; now?: () => number } = {},
) {
  const now = input.now ?? Date.now
  // Nothing outside this process can hold a blob id at startup, so no grace applies.
  collectBlobs(db, Infinity)
  let collected = now()
  let orphans = false
  const byKey = eq(document.key, sql.placeholder("key"))
  const read = db.select({ value: document.value }).from(document).where(byKey).prepare()
  const remove = db.delete(document).where(byKey).prepare()
  const upsert = db
    .insert(document)
    .values({ key: sql.placeholder("key"), value: sql.placeholder("value") })
    .onConflictDoUpdate({ target: document.key, set: { value: sql.placeholder("value") } })
    .prepare()
  const writer = createWriteBehind<string | null>({
    delay: input.delay ?? 500,
    onError: input.onError,
    write: (batch) => {
      const at = now()
      db.transaction(() => {
        for (const [key, value] of batch) {
          if (value === null) {
            remove.run({ key })
            continue
          }
          upsert.run({ key, value })
          // Referencing a blob keeps it alive; done here so a reference the renderer republished
          // from its cache is refreshed even though no upload happened.
          if (json(value))
            db.run(sql`UPDATE ${blobs} SET touched_at = ${at} WHERE ${blobs.id} IN (${referenced(value)})`)
        }
      })
      // Only a document rewrite can orphan a blob, so collect right after one when due.
      if (!orphans || at - collected < collectInterval) return
      collectBlobs(db, at - blobGrace)
      collected = at
      orphans = false
    },
  })

  return {
    get(key: string) {
      if (writer.has(key)) return writer.get(key) ?? null
      return read.get({ key })?.value ?? null
    },
    set: (key: string, value: string | null) => writer.set(key, value),
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      const touched_at = now()
      db.insert(blobs)
        .values({ id, data: Buffer.from(data), touched_at })
        .onConflictDoUpdate({ target: blobs.id, set: { touched_at } })
        .run()
      orphans = true
      return id
    },
    getBlob(id: string): Uint8Array | null {
      return db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null
    },
    flush: writer.flush,
    close: writer.close,
  }
}

function json(value: string) {
  return value.startsWith("{") || value.startsWith("[")
}

// Drop blobs no stored document references and nothing has touched since `before`.
function collectBlobs(db: Database, before: number) {
  db.run(sql`
    DELETE FROM ${blobs}
    WHERE ${blobs.touched_at} < ${before === Infinity ? Number.MAX_SAFE_INTEGER : before}
      AND ${blobs.id} NOT IN (
        SELECT json_extract(node.value, '$.id')
        FROM ${document}, json_tree(${document.value}) AS node
        WHERE json_valid(${document.value}) AND node.key = 'blob' AND node.type = 'object'
          AND json_type(node.value, '$.id') = 'text'
        UNION
        SELECT chunk.value
        FROM ${document}, json_tree(${document.value}) AS node, json_each(node.value, '$.ids') AS chunk
        WHERE json_valid(${document.value}) AND node.key = 'blob' AND node.type = 'object'
          AND json_type(node.value, '$.ids') = 'array'
      )
  `)
}
