import { describe, expect, test } from "bun:test"
import path from "path"
import { Effect } from "effect"
import { SqlClient } from "effect/sql"
import { tmpdir } from "./fixture/tmpdir"

const drivers = [
  ["bun", await import("@opencode/core/database/sqlite.bun")],
  ["node", await import("@opencode/core/database/sqlite.node")],
] as const

describe.each(drivers)("sqlite.%s statement reuse", (_, driver) => {
  test("returns correct results across more distinct queries than the cache holds", async () => {
    await using tmp = await tmpdir()
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`
        yield* sql`INSERT INTO item (id, name) VALUES (${1}, ${"one"}), (${2}, ${"two"})`
        const select = (n: number) =>
          sql.unsafe<{ name: string; n: number }>(`SELECT name, ${n} AS n FROM item WHERE id = ?`, [1 + (n % 2)])
        const first = yield* Effect.forEach(
          Array.from({ length: 700 }, (_, n) => n),
          select,
        )
        const again = yield* Effect.forEach([0, 1, 699], select)
        return [...first, ...again].map((rows) => rows[0])
      }).pipe(Effect.provide(driver.sqliteLayer({ filename: path.join(tmp.path, "test.db") })), Effect.scoped),
    )
    expect(results).toHaveLength(703)
    expect(results[0]).toEqual({ name: "one", n: 0 })
    expect(results[699]).toEqual({ name: "two", n: 699 })
    expect(results.slice(700)).toEqual([
      { name: "one", n: 0 },
      { name: "two", n: 1 },
      { name: "two", n: 699 },
    ])
  })

  test("keeps row and array results separate for the same SQL", async () => {
    await using tmp = await tmpdir()
    const results = await Effect.runPromise(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const query = () => sql`SELECT ${1} AS a, ${"x"} AS b`
        return [yield* query(), yield* query().values, yield* query(), yield* query().values]
      }).pipe(Effect.provide(driver.sqliteLayer({ filename: path.join(tmp.path, "test.db") })), Effect.scoped),
    )
    expect(results).toEqual([[{ a: 1, b: "x" }], [[1, "x"]], [{ a: 1, b: "x" }], [[1, "x"]]])
  })
})
