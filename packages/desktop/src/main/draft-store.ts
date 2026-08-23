import { createHash } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/node-sqlite"
import { blob, sqliteTable, text } from "drizzle-orm/sqlite-core"

const documents = sqliteTable("document", {
  key: text().primaryKey(),
  value: text().notNull(),
})
const blobs = sqliteTable("blob", {
  id: text().primaryKey(),
  data: blob({ mode: "buffer" }).notNull(),
})

export function createDesktopDraftStore(filename: string) {
  const native = new DatabaseSync(filename)
  native.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS document (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS blob (id TEXT PRIMARY KEY, data BLOB NOT NULL);",
  )
  const db = drizzle({ client: native })
  const used = new Set<string>()
  db.select({ value: documents.value })
    .from(documents)
    .all()
    .forEach(({ value }) =>
      JSON.parse(value, (_key, item) => {
        if (item?.blob && typeof item.blob.id === "string") used.add(item.blob.id)
        return item
      }),
    )
  db.select({ id: blobs.id })
    .from(blobs)
    .all()
    .filter(({ id }) => !used.has(id))
    .forEach(({ id }) => db.delete(blobs).where(eq(blobs.id, id)).run())
  const pending = new Map<string, string | null>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = undefined
    const writes = [...pending]
    pending.clear()
    db.transaction((tx) => {
      writes.forEach(([key, value]) => {
        if (value === null) tx.delete(documents).where(eq(documents.key, key)).run()
        else
          tx.insert(documents)
            .values({ key, value })
            .onConflictDoUpdate({ target: documents.key, set: { value } })
            .run()
      })
    })
  }
  const schedule = () => {
    if (!timer) timer = setTimeout(flush, 500)
  }
  return {
    get: (key: string) =>
      pending.has(key)
        ? (pending.get(key) ?? null)
        : (db.select({ value: documents.value }).from(documents).where(eq(documents.key, key)).get()?.value ?? null),
    set(key: string, value: string | null) {
      pending.set(key, value)
      schedule()
    },
    putBlob(data: Uint8Array) {
      const id = createHash("sha256").update(data).digest("hex")
      db.insert(blobs)
        .values({ id, data: Buffer.from(data) })
        .onConflictDoNothing()
        .run()
      return id
    },
    getBlob: (id: string) => db.select({ data: blobs.data }).from(blobs).where(eq(blobs.id, id)).get()?.data ?? null,
    flush,
    close() {
      flush()
      native.close()
    },
  }
}
