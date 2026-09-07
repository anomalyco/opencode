import { and, eq, sql } from "drizzle-orm"
import type { Database } from "./database"
import { state } from "./schema"
import { createWriteBehind } from "./write-behind"

export type StateStore = ReturnType<typeof createStateStore>

type Row = { name: string; key: string; value: string | null }

// Reads hit SQLite directly: they happen at mount time and a point lookup on the primary key
// costs microseconds, so a second in-memory copy would only duplicate the renderer's cache.
export function createStateStore(db: Database, input: { delay?: number; onError?: (error: unknown) => void } = {}) {
  // Prepared once; the flush loop then only binds values instead of rebuilding SQL per row.
  const byKey = and(eq(state.name, sql.placeholder("name")), eq(state.key, sql.placeholder("key")))
  const read = db.select({ value: state.value }).from(state).where(byKey).prepare()
  const remove = db.delete(state).where(byKey).prepare()
  const upsert = db
    .insert(state)
    .values({
      name: sql.placeholder("name"),
      key: sql.placeholder("key"),
      value: sql.placeholder("value"),
      updated_at: sql.placeholder("updated_at"),
    })
    .onConflictDoUpdate({
      target: [state.name, state.key],
      set: { value: sql.placeholder("value"), updated_at: sql.placeholder("updated_at") },
    })
    .prepare()
  const writer = createWriteBehind<Row>({
    delay: input.delay ?? 250,
    onError: input.onError,
    write: (batch) =>
      db.transaction(() => {
        const updated_at = Date.now()
        for (const row of batch.values()) {
          if (row.value === null) remove.run({ name: row.name, key: row.key })
          else upsert.run({ name: row.name, key: row.key, value: row.value, updated_at })
        }
      }),
  })
  const id = (name: string, key: string) => `${name}\0${key}`
  const keys = (name: string) => {
    const result = new Set(
      db
        .select({ key: state.key })
        .from(state)
        .where(eq(state.name, name))
        .all()
        .map((row) => row.key),
    )
    for (const row of writer.entries()) {
      if (row.name !== name) continue
      if (row.value === null) result.delete(row.key)
      else result.add(row.key)
    }
    return [...result]
  }

  return {
    get(name: string, key: string) {
      const queued = writer.get(id(name, key))
      if (queued) return queued.value
      return read.get({ name, key })?.value ?? null
    },
    set: (name: string, key: string, value: string) => writer.set(id(name, key), { name, key, value }),
    delete: (name: string, key: string) => writer.set(id(name, key), { name, key, value: null }),
    keys,
    length: (name: string) => keys(name).length,
    // Rare (window closed for good, explicit clear) so it goes straight to the database.
    clear(name: string) {
      writer.drop((row) => row.name === name)
      db.delete(state).where(eq(state.name, name)).run()
    },
    flush: writer.flush,
    close: writer.close,
  }
}
