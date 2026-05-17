import { Pool } from "pg"
import { describe, expect, test } from "vitest"
import { useIsolatedDatabase } from "../support/with-db"

describe("isolated postgres (vitest + testcontainers)", () => {
  const db = useIsolatedDatabase()

  test("answers select 1", async () => {
    if (!db.url) throw new Error("DATABASE_URL not set — beforeAll did not run or failed")
    const pool = new Pool({ connectionString: db.url })
    const r = await pool.query<{ n: number }>("select 1 as n")
    await pool.end()
    const row = r.rows[0]
    if (!row) throw new Error("expected row")
    expect(row.n).toBe(1)
  })
})
