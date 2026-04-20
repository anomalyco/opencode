import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db.pg"

describe("Database", () => {
  test("initializes postgres access", async () => {
    await expect(Database.initialize()).resolves.toBeUndefined()
  })

  test("runs queries through use", async () => {
    const result = await Database.use(async (db) => {
      const rows = await db.execute("select 1 as ok")
      return rows.rows[0]
    })

    expect(result).toEqual({ ok: 1 })
  })
})
