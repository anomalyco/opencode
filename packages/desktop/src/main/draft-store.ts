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
  // Reclaiming unreferenced blobs means looking through the drafts for the ids they mention,
  // so its cost follows how much text the profile has saved. Opening the store used to read
  // every draft back and JSON.parse it, which put megabytes of text in front of the first
  // window. Nothing about it is needed for the app to start, so it runs on a timer instead,
  // and a profile with no blobs never looks at a draft at all.
  const collectBlobs = () => {
    try {
      // A draft still sitting in the write buffer already references its attachment, so the
      // sweep has to see it before deciding the blob is unused.
      flush()
      const stored = native.prepare("SELECT id FROM blob").all() as { id: string }[]
      if (stored.length === 0) return
      // LIKE stops at the first draft that mentions the blob, so a blob still in use costs
      // far less than a full pass. Binding the pattern keeps SQLite from rebuilding it per row.
      const referenced = native.prepare("SELECT 1 FROM document WHERE value LIKE ? LIMIT 1")
      const remove = native.prepare("DELETE FROM blob WHERE id = ?")
      stored.forEach(({ id }) => {
        if (referenced.get(`%"id":"${id}"%`)) return
        remove.run(id)
      })
    } catch {
      // Keeping an orphaned blob costs disk space; failing to open the store costs the app.
    }
  }
  let collector: ReturnType<typeof setTimeout> | undefined = setTimeout(collectBlobs, 10_000)
  collector.unref?.()
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
    collectBlobs,
    close() {
      if (collector) clearTimeout(collector)
      collector = undefined
      flush()
      native.close()
    },
  }
}
