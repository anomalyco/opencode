import { Database } from "bun:sqlite"
import { Effect } from "effect"
import { expect, test } from "bun:test"
import { queryR2SqlPages, R2SqlQueryError, type R2SqlData } from "./r2-sql"

test("includes the transport failure in the message used by sync logging", () => {
  const cause = new DOMException("The operation timed out.", "TimeoutError")
  const error = new R2SqlQueryError({ message: "Failed to run R2 SQL stats query", cause })

  expect(error.message).toBe("Failed to run R2 SQL stats query: TimeoutError: The operation timed out.")
  expect(error.cause).toBe(cause)
})

test("preserves an R2 response error and request details", () => {
  const error = new R2SqlQueryError({ message: "R2 SQL stats query failed", status: 400, requestId: "test-request" })

  expect(error.message).toBe("R2 SQL stats query failed")
  expect(error.status).toBe(400)
  expect(error.requestId).toBe("test-request")
})

// Execute the generated pagination SQL against real aggregate rows, including
// groups that share country/model prefixes across a page boundary.
for (const count of [0, 9999, 10000, 10001, 20005]) {
  test(`reads all ${count} aggregate rows without losing or repeating groups`, async () => {
    using db = new Database(":memory:")
    db.run("CREATE TABLE aggregates (dimension TEXT, model TEXT, country TEXT, requests TEXT)")
    db.transaction(() => {
      const insert = db.prepare("INSERT INTO aggregates VALUES (?, ?, ?, ?)")
      Array.from({ length: count }, (_, index) => {
        insert.run(
          index < 2 ? "geo" : "geo_model",
          index < 2 ? null : `model'${Math.floor(index / 3)}`,
          `country${index % 3}`,
          String(index + 1),
        )
      })
    })()
    const pages: number[] = []
    const rows = await Effect.runPromise(
      queryR2SqlPages("SELECT * FROM aggregates", ["dimension", "model", "country"], (query) =>
        Effect.sync(() => {
          const rows = db.query(query).all() as R2SqlData[]
          pages.push(rows.length)
          return rows
        }),
      ),
    )
    expect(rows).toHaveLength(count)
    expect(new Set(rows.map((row) => row.requests)).size).toBe(count)
    expect(rows.reduce((sum, row) => sum + Number(row.requests), 0)).toBe((count * (count + 1)) / 2)
    expect(pages).toHaveLength(Math.floor(count / 10000) + 1)
    expect(pages.at(-1)).toBe(count % 10000)
  })
}

test("still rejects capped results without an aggregate cursor", async () => {
  const result = await Effect.runPromise(
    queryR2SqlPages("SELECT * FROM aggregates LIMIT 10000", undefined, () =>
      Effect.succeed(Array.from({ length: 10000 }, () => ({}))),
    ).pipe(Effect.flip),
  )
  expect(result.message).toContain("10000 row limit")
})

test("propagates a later page failure instead of returning partial aggregates", async () => {
  const calls: string[] = []
  const error = new R2SqlQueryError({ message: "second page failed" })
  const result = await Effect.runPromise(
    queryR2SqlPages("SELECT * FROM aggregates", ["model"], (query) => {
      calls.push(query)
      return calls.length === 1
        ? Effect.succeed(Array.from({ length: 10000 }, (_, index) => ({ model: String(index) })))
        : Effect.fail(error)
    }).pipe(Effect.flip),
  )
  expect(result).toBe(error)
  expect(calls).toHaveLength(2)
})

test("retries a transient timeout on the same page without repeating earlier rows", async () => {
  const calls: string[] = []
  const rows = await Effect.runPromise(
    queryR2SqlPages("SELECT * FROM aggregates", ["model"], (query) => {
      calls.push(query)
      if (calls.length === 1)
        return Effect.succeed(Array.from({ length: 10000 }, (_, index) => ({ model: String(index).padStart(5, "0") })))
      if (calls.length === 2)
        return Effect.fail(new R2SqlQueryError({ message: "query timeout", status: 400, code: 40005 }))
      return Effect.succeed([{ model: "10000" }])
    }),
  )
  expect(rows).toHaveLength(10001)
  expect(new Set(rows.map((row) => row.model)).size).toBe(10001)
  expect(calls).toHaveLength(3)
  expect(calls[1]).toBe(calls[2])
  expect(calls[0]).not.toBe(calls[1])
}, 10000)

test("bounds transient retries and preserves the final error", async () => {
  const calls: string[] = []
  const error = new R2SqlQueryError({ message: "unavailable", status: 503 })
  const result = await Effect.runPromise(
    queryR2SqlPages("SELECT * FROM aggregates", undefined, (query) => {
      calls.push(query)
      return Effect.fail(error)
    }).pipe(Effect.flip),
  )
  expect(calls).toHaveLength(3)
  expect(result).toBe(error)
}, 20000)
