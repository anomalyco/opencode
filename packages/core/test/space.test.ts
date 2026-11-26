import { describe, expect } from "bun:test"
import { SqliteClient } from "@effect/sql-sqlite-bun"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient, Statement } from "effect/sql"
import { SpaceRows } from "@opencode/core/space"
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
      expect(yield* SpaceRows.head(db, "app")).toBe(0)
      expect(yield* SpaceRows.set(db, "app", "a", "1")).toBe(1)
      expect(yield* SpaceRows.set(db, "app", "b", '{"n":1}')).toBe(2)
      expect(yield* SpaceRows.set(db, "other", "a", "x")).toBe(1)
      expect(yield* SpaceRows.set(db, "app", "a", "2")).toBe(3)
      expect(yield* SpaceRows.remove(db, "app", "b")).toBe(4)
      // Removing a missing or already removed key writes nothing and takes no revision.
      expect(yield* SpaceRows.remove(db, "app", "b")).toBeUndefined()
      expect(yield* SpaceRows.remove(db, "app", "never")).toBeUndefined()
      expect(yield* rows).toEqual([
        { space: "app", key: "a", value: "2", revision: 3 },
        { space: "app", key: "b", value: null, revision: 4 },
        { space: "other", key: "a", value: "x", revision: 1 },
      ])
      expect(yield* SpaceRows.head(db, "app")).toBe(4)
      expect(yield* SpaceRows.changes(db, "app", 2)).toEqual([
        { key: "a", value: "2", revision: 3 },
        { key: "b", value: null, revision: 4 },
      ])
      expect(yield* SpaceRows.set(db, "app", "b", "true")).toBe(5)
    }),
  )

  it.effect("writes changes in order in one transaction, returning those that changed a row and the head", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      expect(
        yield* SpaceRows.write(db, "batch", [
          { key: "a", value: "1" },
          { key: "b", value: null },
          { key: "a", value: null },
          { key: "a", value: null },
          { key: "b", value: "2" },
        ]),
      ).toEqual({
        written: [
          { key: "a", value: "1", revision: 1 },
          { key: "a", value: null, revision: 2 },
          { key: "b", value: "2", revision: 3 },
        ],
        head: 3,
      })
      expect(yield* SpaceRows.write(db, "batch", [{ key: "c", value: null }])).toEqual({ written: [], head: 3 })
      expect(yield* SpaceRows.write(db, "unwritten", [])).toEqual({ written: [], head: 0 })
    }),
  )

  it.effect("keeps a space's newest tombstones and raises its floor to the highest purged one", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const remove = (space: string, key: string, limit: number) =>
        SpaceRows.remove(db, space, key).pipe(Effect.tap(SpaceRows.purge(db, space, limit)))
      const tombstones = db
        .select({ key: SpaceTable.key, revision: SpaceTable.revision })
        .from(SpaceTable)
        .where(and(eq(SpaceTable.space, "pruned"), isNull(SpaceTable.value)))
        .orderBy(asc(SpaceTable.revision))
        .all()
      yield* Effect.forEach(["a", "b", "c", "d", "e", "f"], (key) => SpaceRows.set(db, "pruned", key, key), {
        discard: true,
      })
      yield* SpaceRows.set(db, "kept", "a", "1")
      yield* remove("kept", "a", 2)
      expect(yield* remove("pruned", "a", 2)).toBe(7)
      expect(yield* remove("pruned", "b", 2)).toBe(8)
      expect(yield* SpaceRows.floor(db, "pruned")).toBe(0)

      // The third tombstone passes the limit of 2: the oldest goes.
      expect(yield* remove("pruned", "c", 2)).toBe(9)
      expect(yield* tombstones).toEqual([
        { key: "b", revision: 8 },
        { key: "c", revision: 9 },
      ])
      expect(yield* SpaceRows.floor(db, "pruned")).toBe(7)
      expect(yield* remove("pruned", "d", 2)).toBe(10)
      expect(yield* SpaceRows.floor(db, "pruned")).toBe(8)
      // Further past the limit, the purge goes straight back down to it, and the floor only rises.
      expect(yield* remove("pruned", "e", 1)).toBe(11)
      expect(yield* tombstones).toEqual([{ key: "e", revision: 11 }])
      expect(yield* SpaceRows.floor(db, "pruned")).toBe(10)

      // Live rows and other spaces stay, and the newest tombstone keeps the head, so no revision is reissued.
      expect(yield* SpaceRows.changes(db, "pruned", 0)).toEqual([
        { key: "f", value: "f", revision: 6 },
        { key: "e", value: null, revision: 11 },
      ])
      expect(yield* SpaceRows.changes(db, "kept", 0)).toEqual([{ key: "a", value: null, revision: 2 }])
      expect(yield* SpaceRows.floor(db, "kept")).toBe(0)
      expect(yield* SpaceRows.head(db, "pruned")).toBe(11)
      expect(yield* SpaceRows.set(db, "pruned", "a", "1")).toBe(12)
      // A new epoch leaves floors as they are.
      yield* SpaceRows.resetEpoch(db)
      expect(yield* SpaceRows.floor(db, "pruned")).toBe(10)
    }),
  )
})

local.effect("reads and writes a space through its indexes: deltas on the revision index, snapshots on live rows", () =>
  Effect.gen(function* () {
    const db = (yield* Database.Service).db
    const client = yield* SqlClient.SqlClient
    yield* Effect.forEach(["a", "b", "c"], (key) => SpaceRows.set(db, "app", key, key), { discard: true })
    yield* SpaceRows.set(db, "other", "a", "1")
    yield* SpaceRows.remove(db, "app", "c")
    statements.length = 0

    yield* SpaceRows.set(db, "app", "a", "again")
    // Then a purge past a limit of 1 takes c's tombstone.
    yield* SpaceRows.remove(db, "app", "b")
    yield* SpaceRows.purge(db, "app", 1)
    yield* SpaceRows.floor(db, "app")
    yield* SpaceRows.head(db, "app")
    yield* SpaceRows.changes(db, "app", 2)
    yield* SpaceRows.live(db, "app", 0, 6, 500)
    const plans = yield* Effect.forEach(
      statements.filter((statement) => /^\s*(select|insert|update|delete)\b/iu.test(statement.query)),
      (statement) =>
        client
          .unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${statement.query}`, statement.params)
          .pipe(Effect.map((rows) => rows.map((row) => row.detail))),
    )
    const revisionIndex = "SEARCH space USING COVERING INDEX space_revision_idx (space=?)"
    const tombstoneIndex = "SEARCH space USING COVERING INDEX space_tombstone_idx (space=?)"
    const primaryKey = "SEARCH space USING INDEX sqlite_autoindex_space_1 (space=? AND key=?)"
    expect(plans).toEqual([
      // set: the next revision from the end of the space's index range.
      ["SCALAR SUBQUERY 1", revisionIndex],
      // remove: the row by primary key, and the next revision.
      [primaryKey, "SCALAR SUBQUERY 1", revisionIndex],
      // purge: the tombstones counted, the highest one to purge found and the purge, all on their own index.
      [tombstoneIndex],
      [tombstoneIndex],
      ["SEARCH space USING INDEX space_tombstone_idx (space=? AND revision<?)"],
      // and the floor written, which needs no search.
      [],
      // floor
      [primaryKey],
      // head
      [revisionIndex],
      // changes
      ["SEARCH space USING INDEX space_revision_idx (space=? AND revision>?)"],
      // live
      ["SEARCH space USING INDEX space_live_idx (space=? AND revision>? AND revision<?)"],
    ])
  }),
)
