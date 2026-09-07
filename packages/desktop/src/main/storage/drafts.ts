import { createHash } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import { blobs, document } from "./schema"
import { createWriteBehind } from "./write-behind"

export type DraftStore = ReturnType<typeof createDraftStore>

// Editing a large paste retires one text chunk per save, so orphans accumulate while the app runs.
const collectInterval = 60_000

export function createDraftStore(
  db: Database,
  input: { delay?: number; onError?: (error: unknown) => void; now?: () => number } = {},
) {
  const now = input.now ?? Date.now
  collectBlobs(db)
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
      db.transaction(() => {
        for (const [key, value] of batch) {
          if (value === null) remove.run({ key })
          else upsert.run({ key, value })
        }
      })
      // Only a document rewrite can orphan a blob, so collect right after one when due.
      if (!orphans || now() - collected < collectInterval) return
      collectBlobs(db)
      collected = now()
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
      db.insert(blobs)
        .values({ id, data: Buffer.from(data) })
        .onConflictDoNothing()
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

// Blobs are content-addressed and shared; drop the ones no document references anymore, whether
// as an image `{ blob: { id } }` or a text chunk list `{ blob: { kind: "text", ids: [...] } }`.
// SQLite walks the JSON itself, so nothing here parses drafts in JavaScript.
function collectBlobs(db: Database) {
  db.run(sql`
    DELETE FROM ${blobs} WHERE ${blobs.id} NOT IN (
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
