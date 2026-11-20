import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { asc } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import { Space } from "@opencode/core/space"
import { SpaceTable } from "@opencode/core/space/sql"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { tempGlobalLayer } from "./fixture/global"
import { testEffect } from "./lib/effect"

// Every statement the database runs, so a test can ask SQLite how it plans the ones Space issues.
const statements: Array<{ readonly query: string; readonly params: ReadonlyArray<unknown> }> = []

const recording = Layer.effect(
  SqlClient.SqlClient,
  Effect.gen(function* () {
    const client = yield* SqlClient.SqlClient
    const connection = yield* client.reserve
    const record = (query: string, params: ReadonlyArray<unknown>) => statements.push({ query, params })
    return yield* SqlClient.make({
      acquirer: Effect.succeed({
        ...connection,
        execute: (query, params, transform) => {
          record(query, params)
          return connection.execute(query, params, transform)
        },
        executeValues: (query, params) => {
          record(query, params)
          return connection.executeValues(query, params)
        },
      }),
      compiler: Statement.makeCompilerSqlite(),
      driver: client.driver,
      spanAttributes: [],
    })
  }),
).pipe(Layer.provide(SqliteClient.layer({ filename: ":memory:", disableWAL: true })), Layer.provide(Reactivity.layer))

const local = testEffect(Database.layerFromClient.pipe(Layer.provideMerge(recording), Layer.provide(tempGlobalLayer)))
const durableObject = testEffect(
  Database.layerFromClient.pipe(
    Layer.provide(sqliteLayer({ storage: makeDurableObjectStorage() })),
    Layer.provide(tempGlobalLayer),
  ),
)

describe.each([
  ["local SQLite", local],
  ["Durable Object storage", durableObject],
] as const)("Space over %s", (_, it) => {
  it.effect("numbers each space's writes on its own and keeps deletes as tombstones", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const rows = db.select().from(SpaceTable).orderBy(asc(SpaceTable.space), asc(SpaceTable.key)).all()
      expect(yield* Space.head(db, "app")).toBe(0)
      expect(yield* Space.set(db, "app", "a", 1)).toBe(1)
      expect(yield* Space.set(db, "app", "b", { n: 1 })).toBe(2)
      expect(yield* Space.set(db, "other", "a", "x")).toBe(1)
      expect(yield* Space.set(db, "app", "a", 2)).toBe(3)
      expect(yield* Space.remove(db, "app", "b")).toBe(4)
      // Removing a missing or already removed key writes nothing and takes no revision.
      expect(yield* Space.remove(db, "app", "b")).toBeUndefined()
      expect(yield* Space.remove(db, "app", "never")).toBeUndefined()
      expect(yield* rows).toEqual([
        { space: "app", key: "a", value: 2, revision: 3 },
        { space: "app", key: "b", value: null, revision: 4 },
        { space: "other", key: "a", value: "x", revision: 1 },
      ])
      expect(yield* Space.head(db, "app")).toBe(4)
      expect(yield* Space.changes(db, "app", 2)).toEqual([
        { key: "a", value: 2, revision: 3 },
        { key: "b", value: null, revision: 4 },
      ])
      expect(yield* Space.set(db, "app", "b", true)).toBe(5)
    }),
  )
})

local.effect("reads and writes a space through its indexes, and catches up with one range of the revision index", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const client = yield* SqlClient.SqlClient
    yield* Effect.forEach(["a", "b", "c"], (key) => Space.set(db, "app", key, key), { discard: true })
    yield* Space.set(db, "other", "a", 1)
    statements.length = 0

    yield* Space.set(db, "app", "a", "again")
    yield* Space.remove(db, "app", "b")
    yield* Space.head(db, "app")
    yield* Space.changes(db, "app", 2)
    const plans = yield* Effect.forEach(
      statements.filter((statement) => /^\s*(select|insert|update)\b/iu.test(statement.query)),
      (statement) =>
        client
          .unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${statement.query}`, statement.params)
          .pipe(Effect.map((rows) => rows.map((row) => row.detail))),
    )
    const revisionIndex = "SEARCH space USING COVERING INDEX space_revision_idx (space=?)"
    expect(plans).toEqual([
      // set: the next revision from the end of the space's index range.
      ["SCALAR SUBQUERY 1", revisionIndex],
      // remove: the row by primary key, and the next revision.
      ["SEARCH space USING INDEX sqlite_autoindex_space_1 (space=? AND key=?)", "SCALAR SUBQUERY 1", revisionIndex],
      // head
      [revisionIndex],
      // changes
      ["SEARCH space USING INDEX space_revision_idx (space=? AND revision>?)"],
    ])
  }),
)
