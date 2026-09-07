import { createHash } from "node:crypto"
import { eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import { blobs, document } from "./schema"
import { createWriteBehind } from "./write-behind"

export type DraftStore = ReturnType<typeof createDraftStore>

export function createDraftStore(db: Database, input: { delay?: number; onError?: (error: unknown) => void } = {}) {
  collectBlobs(db)
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
    write: (batch) =>
      db.transaction(() => {
        for (const [key, value] of batch) {
          if (value === null) remove.run({ key })
          else upsert.run({ key, value })
        }
      }),
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
      return id
    },
    getBlob(id: string): Uint8Array | null {
      return db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null
    },
    flush: writer.flush,
    close: writer.close,
  }
}

// Blobs are content-addressed and shared; drop the ones no document references anymore. SQLite
// walks the JSON itself, so startup does not parse every draft and history entry in JavaScript.
function collectBlobs(db: Database) {
  db.run(sql`
    DELETE FROM ${blobs} WHERE ${blobs.id} NOT IN (
      SELECT json_extract(node.value, '$.id')
      FROM ${document}, json_tree(${document.value}) AS node
      WHERE json_valid(${document.value}) AND node.key = 'blob' AND node.type = 'object'
    )
  `)
}
