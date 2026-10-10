import { expect, test } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { getTableColumns, sql } from "drizzle-orm"
import { sqliteTable, text } from "drizzle-orm/sqlite-core"
import { Effect } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { EffectDrizzleSqlite } from "@opencode/core/database/drizzle"
import { directoryColumn } from "@opencode/core/database/path"

// Mirrors `session_v2.directory`, the column that decodes a persisted session directory. The
// mapping under test lives on this column, so the rest of the session schema is not needed.
const probe = sqliteTable("directory_probe", {
  id: text().primaryKey(),
  directory: directoryColumn().notNull(),
})
const directory = getTableColumns(probe).directory

// Older web builds stored the session's own URL in `directory`.
const legacyDirectory =
  "http://localhost:3333/L2hvbWUvamFuL3Byb2plY3RzL2hpcHBvY2FjdHVz/session/ses_13416c6c1ffeuwjo0B1mxirCjT"

const run = <A, E>(effect: Effect.Effect<A, E, SqlClient>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Effect.scoped),
  )

// The write path rejects a value like this, so it is planted directly — exactly how a database
// written by an older build looks.
const seed = (rows: { id: string; directory: string }[]) =>
  Effect.gen(function* () {
    const db = yield* EffectDrizzleSqlite.makeWithDefaults()
    yield* db.run(sql`create table directory_probe (id text primary key, directory text not null)`)
    for (const row of rows) {
      yield* db.run(sql`insert into directory_probe (id, directory) values (${row.id}, ${row.directory})`)
    }
    return db
  })

test("lists a session whose stored directory is not a filesystem path", async () => {
  await run(
    Effect.gen(function* () {
      // Decoding runs per row, so the legacy value used to abort the whole statement and the
      // healthy row went down with it.
      const db = yield* seed([
        { id: "a-legacy", directory: legacyDirectory },
        { id: "b-project", directory: "/project" },
      ])

      expect(yield* db.select().from(probe).orderBy(probe.id)).toEqual([
        { id: "a-legacy", directory: legacyDirectory },
        { id: "b-project", directory: "/project" },
      ])
    }),
  )
})

test("keeps an empty directory readable", async () => {
  await run(
    Effect.gen(function* () {
      const db = yield* seed([{ id: "empty", directory: "" }])

      expect(yield* db.select().from(probe)).toEqual([{ id: "empty", directory: "" }])
    }),
  )
})

test("keeps the write path strict", () => {
  expect(() => directory.mapToDriverValue(legacyDirectory)).toThrow(`Path is not absolute: ${legacyDirectory}`)
})
