import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db.pg"
import { runPostgresMigrations } from "../../src/storage/migrate-pg"
import { listProjectsSimple } from "../../src/storage/project-pg"
import { withIsolatedPg } from "../helpers/with-isolated-pg"

describe("postgres migrate (isolated empty db)", () => {
  test(
    "listProjectsSimple fails before migrate; after migrate queries succeed",
    async () => {
      await withIsolatedPg(async () => {
        await Database.initialize()

        const missing = await listProjectsSimple("any_tenant").then(
          () => false,
          (e) => {
            const msg = e instanceof Error ? e.message : String(e)
            if (!/relation|42P01|does not exist|Failed query/i.test(msg)) throw e
            return true
          },
        )
        expect(missing).toBe(true)

        await runPostgresMigrations()

        const empty = await listProjectsSimple("any_tenant")
        expect(empty.length).toBe(0)
      })
    },
    180_000,
  )
})
