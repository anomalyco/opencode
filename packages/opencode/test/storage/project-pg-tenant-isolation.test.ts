import { describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db.pg"
import { runPostgresMigrations } from "../../src/storage/migrate-pg"
import { createProjectSimple, listProjectsSimple } from "../../src/storage/project-pg"
import { withIsolatedPg } from "../helpers/with-isolated-pg"

describe("postgres tenant project isolation (isolated db)", () => {
  test(
    "two tenants each see only their own projects",
    async () => {
      await withIsolatedPg(async () => {
        await Database.initialize()
        await runPostgresMigrations()

        await createProjectSimple({ name: "TenantA", tenantUserId: "user_a" })
        await createProjectSimple({ name: "TenantB", tenantUserId: "user_b" })

        const listA = await listProjectsSimple("user_a")
        const listB = await listProjectsSimple("user_b")
        expect(listA.length).toBe(1)
        expect(listB.length).toBe(1)
        expect(listA[0].name).toBe("TenantA")
        expect(listB[0].name).toBe("TenantB")
        expect(String(listA[0].id)).not.toBe(String(listB[0].id))
      })
    },
    180_000,
  )
})
