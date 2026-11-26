import { describe, expect } from "bun:test"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"
import { SpaceRows } from "@opencode/core/space"
import { SpaceTable } from "@opencode/core/space/sql"
import { Database } from "@opencode/core/database/database"
import { sqliteLayer } from "@opencode/core/database/sqlite.workerd"
import { makeDurableObjectStorage } from "./fixture/durable-object-storage"
import { tempGlobalLayer } from "./fixture/global"
import { recordedSql } from "./fixture/recorded-sql"
import { testEffect } from "./lib/effect"

// Every statement the database runs, so a test can ask SQLite how it plans the ones Space issues.
const recorded = recordedSql()
const statements = recorded.statements

const local = testEffect(
  Database.layerFromClient.pipe(Layer.provideMerge(recorded.layer), Layer.provide(tempGlobalLayer)),
)
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
      expect(yield* SpaceRows.read(db, "app", { type: "delta", since: 2, snapshot: false }, 10)).toEqual({
        head: 4,
        continued: true,
        rows: [
          { key: "a", value: "2", revision: 3 },
          { key: "b", value: null, revision: 4 },
        ],
      })
      expect(yield* SpaceRows.set(db, "app", "b", "true")).toBe(5)
    }),
  )

  it.effect(
    "writes changes in order in one transaction, returning those that changed a row and each space's head",
    () =>
      Effect.gen(function* () {
        const db = (yield* Database.Service).db
        expect(
          yield* SpaceRows.write(db, [
            { space: "batch", key: "a", value: "1" },
            { space: "second", key: "a", value: "x" },
            { space: "batch", key: "b", value: null },
            { space: "batch", key: "a", value: null },
            { space: "second", key: "a", value: "y" },
            { space: "batch", key: "a", value: null },
            { space: "batch", key: "b", value: "2" },
          ]),
        ).toEqual({
          written: [
            { space: "batch", key: "a", value: "1", revision: 1 },
            { space: "second", key: "a", value: "x", revision: 1 },
            { space: "batch", key: "a", value: null, revision: 2 },
            { space: "second", key: "a", value: "y", revision: 2 },
            { space: "batch", key: "b", value: "2", revision: 3 },
          ],
          heads: [
            { space: "batch", revision: 3 },
            { space: "second", revision: 2 },
          ],
        })
        // A space whose changes change nothing reports its head.
        expect(
          yield* SpaceRows.write(db, [
            { space: "unwritten", key: "c", value: null },
            { space: "batch", key: "c", value: null },
            { space: "second", key: "b", value: "1" },
          ]),
        ).toEqual({
          written: [{ space: "second", key: "b", value: "1", revision: 3 }],
          heads: [
            { space: "unwritten", revision: 0 },
            { space: "batch", revision: 3 },
            { space: "second", revision: 3 },
          ],
        })
      }),
  )

  it.effect("reads a page with the head in one statement: a delta, a snapshot, or a snapshot instead of a delta", () =>
    Effect.gen(function* () {
      const db = (yield* Database.Service).db
      const read = (from: SpaceRows.From, limit = 10) => SpaceRows.read(db, "read", from, limit)
      const row = (key: string, value: string | null, revision: number) => ({ key, value, revision })
      // An empty space: a snapshot of nothing at head 0, and a delta from 0.
      expect(yield* read({ type: "snapshot", since: 0 })).toEqual({ head: 0, continued: false, rows: [] })
      expect(yield* read({ type: "delta", since: 0, snapshot: true })).toEqual({ head: 0, continued: true, rows: [] })

      yield* Effect.forEach(["a", "b", "c", "d"], (key) => SpaceRows.set(db, "read", key, key), { discard: true })
      yield* SpaceRows.remove(db, "read", "a")
      yield* SpaceRows.remove(db, "read", "b")
      // With a limit of 1, the purge takes a's tombstone at revision 5: the floor is 5, the head 6.
      yield* SpaceRows.purge(db, "read", 1)
      yield* SpaceRows.set(db, "other", "x", "1")

      // A snapshot reads live rows only, up to the head without `until`, and `limit` of them.
      expect(yield* read({ type: "snapshot", since: 0 })).toEqual({
        head: 6,
        continued: false,
        rows: [row("c", "c", 3), row("d", "d", 4)],
      })
      expect(yield* read({ type: "snapshot", since: 0 }, 1)).toEqual({
        head: 6,
        continued: false,
        rows: [row("c", "c", 3)],
      })
      // A continuation up to its own head; one past the head starts over.
      expect(yield* read({ type: "snapshot", since: 3, until: 4 })).toEqual({
        head: 6,
        continued: true,
        rows: [row("d", "d", 4)],
      })
      expect((yield* read({ type: "snapshot", since: 3, until: 7 })).continued).toBe(false)
      // A delta at or above the floor, tombstones included; at the head, nothing.
      expect(yield* read({ type: "delta", since: 5, snapshot: true })).toEqual({
        head: 6,
        continued: true,
        rows: [row("b", null, 6)],
      })
      expect(yield* read({ type: "delta", since: 6, snapshot: true })).toEqual({ head: 6, continued: true, rows: [] })
      // Below the floor or past the head, a snapshot instead, or no rows without `snapshot`.
      for (const since of [4, 7]) {
        expect(yield* read({ type: "delta", since, snapshot: true })).toEqual({
          head: 6,
          continued: false,
          rows: [row("c", "c", 3), row("d", "d", 4)],
        })
        expect(yield* read({ type: "delta", since, snapshot: false })).toEqual({ head: 6, continued: false, rows: [] })
      }
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
      const stored = (space: string) =>
        db
          .select({ key: SpaceTable.key, value: SpaceTable.value, revision: SpaceTable.revision })
          .from(SpaceTable)
          .where(eq(SpaceTable.space, space))
          .orderBy(asc(SpaceTable.revision))
          .all()
      expect(yield* stored("pruned")).toEqual([
        { key: "f", value: "f", revision: 6 },
        { key: "e", value: null, revision: 11 },
      ])
      expect(yield* stored("kept")).toEqual([{ key: "a", value: null, revision: 2 }])
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
    yield* SpaceRows.head(db, "app")
    const planned = (statement: { readonly query: string; readonly params: ReadonlyArray<unknown> }) =>
      client
        .unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${statement.query}`, statement.params)
        .pipe(Effect.map((rows) => rows.map((row) => row.detail)))
    const plans = yield* Effect.forEach(
      statements.filter((statement) => /^\s*(select|insert|update|delete)\b/iu.test(statement.query)),
      planned,
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
      // head
      [revisionIndex],
    ])

    // Each read is one statement. Its head is one search at the end of the space's revision index and its floor one
    // primary key lookup; its rows are one range of the revision or live index, never a scan of the table.
    const reads = yield* Effect.forEach(
      [
        { type: "snapshot", since: 0 },
        { type: "snapshot", since: 1, until: 5 },
        { type: "delta", since: 2, snapshot: false },
        { type: "delta", since: 2, snapshot: true },
      ] satisfies ReadonlyArray<SpaceRows.From>,
      (from) =>
        Effect.gen(function* () {
          statements.length = 0
          yield* SpaceRows.read(db, "app", from, 501)
          expect(statements).toHaveLength(1)
          return (yield* planned(statements[0])).filter((detail) => /^(SEARCH|SCAN) space\b/u.test(detail))
        }),
    )
    const live = "SEARCH space USING INDEX space_live_idx (space=? AND revision>? AND revision<?)"
    const delta = "SEARCH space USING INDEX space_revision_idx (space=? AND revision>?)"
    expect(reads).toEqual([
      [revisionIndex, live],
      [revisionIndex, live],
      [revisionIndex, primaryKey, delta],
      [revisionIndex, primaryKey, delta, live],
    ])
  }),
)
