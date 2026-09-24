import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { sql } from "drizzle-orm"
import { drizzle } from "drizzle-orm/mysql2"
import { createPool } from "mysql2/promise"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { GoQuotaRepair } from "../src/go-quota-repair"
import { AccountTable } from "../src/schema/account.sql"
import { AuthTable } from "../src/schema/auth.sql"
import { BillingTable, LiteTable } from "../src/schema/billing.sql"
import { GoQuotaRepairTable } from "../src/schema/go-quota-repair.sql"
import { UserTable } from "../src/schema/user.sql"
import { WorkspaceTable } from "../src/schema/workspace.sql"

const input: GoQuotaRepair.Input = {
  idempotencyKey: "quota-repair-fixture",
  email: "quota-test@example.invalid",
  workspaceID: "wrk_quota_fixture",
  liteID: "lit_quota_fixture",
  userID: "usr_quota_fixture",
  customerID: "cus_quota_fixture",
  subscriptionID: "sub_quota_fixture",
  timeCreated: "2026-01-15T08:00:00.123Z",
  periodStart: "2026-08-15T08:00:00.123Z",
  periodEnd: "2026-09-15T08:00:00.123Z",
  expectedMonthlyUsage: 900,
  expectedTimeMonthlyUpdated: "2026-08-20T09:00:00.456Z",
  monthlyUsage: 100,
}

describe("Go quota repair input", () => {
  test("accepts the exact frozen snapshot contract", () => {
    expect(GoQuotaRepair.Input.parse(input)).toEqual(input)
  })

  test.each([
    { monthlyUsage: 900 },
    { monthlyUsage: 901 },
    { monthlyUsage: -1 },
    { monthlyUsage: 0.5 },
    { expectedMonthlyUsage: Number.MAX_SAFE_INTEGER + 1 },
    { expectedMonthlyUsage: null },
    { expectedTimeMonthlyUpdated: null },
    { expectedTimeMonthlyUpdated: "2026-08-20T09:00:00Z" },
    { timeCreated: "2026-01-15T08:00:00.123+00:00" },
    { timeCreated: "2026-02-30T08:00:00.123Z" },
    { idempotencyKey: "" },
    { weeklyUsage: 0 },
  ])("rejects invalid or broadened input %j", (change) => {
    expect(GoQuotaRepair.Input.safeParse({ ...input, ...change }).success).toBe(false)
  })
})

// Opt in with an isolated MySQL 8 container: empty root password, database quota_test,
// published on 127.0.0.1. GO_QUOTA_REPAIR_TEST_PORT is a local port, never a production URL.
const port = process.env.GO_QUOTA_REPAIR_TEST_PORT
describe.skipIf(!port)("Go quota repair MySQL transactions", () => {
  if (port && (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535))
    throw new Error("Expected a local test MySQL port")
  const pool = createPool({
    host: "127.0.0.1",
    port: Number(port),
    user: "root",
    database: "quota_test",
    timezone: "Z",
    connectionLimit: 8,
  })
  const db = drizzle({ client: pool })
  const subscription: Awaited<ReturnType<GoQuotaRepair.Dependencies["subscription"]>> = {
    id: input.subscriptionID,
    status: "active",
    customer: input.customerID,
    items: {
      data: [
        {
          price: {
            id: "price_quota_fixture",
            product: "prod_quota_fixture",
            currency: "usd",
            unit_amount: 1000,
            recurring: {
              interval: "month",
              interval_count: 1,
              usage_type: "licensed",
              meter: null,
              trial_period_days: null,
            },
          },
        },
      ],
    },
  }
  const deps: GoQuotaRepair.Dependencies = {
    use: (callback) => callback(db),
    transaction: (callback) => db.transaction(callback),
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    subscription: async () => structuredClone(subscription),
    go: { priceID: "price_quota_fixture", productID: "prod_quota_fixture", priceInr: 90000 },
  }

  beforeAll(async () => {
    const directory = await mkdtemp(join(tmpdir(), "go-quota-repair-test-"))
    const generate = Bun.spawn(
      [
        "bun",
        "x",
        "drizzle-kit",
        "generate",
        "--dialect",
        "mysql",
        "--schema",
        "./src/schema/{account,auth,billing,user,workspace}.sql.ts",
        "--out",
        directory,
      ],
      { cwd: new URL("..", import.meta.url).pathname, stdout: "pipe", stderr: "pipe" },
    )
    const [stdout, stderr, exit] = await Promise.all([
      new Response(generate.stdout).text(),
      new Response(generate.stderr).text(),
      generate.exited,
    ])
    if (exit !== 0) throw new Error(`Test schema creation failed: ${stdout}\n${stderr}`)
    const [migration] = await readdir(directory)
    const ddl = await Bun.file(join(directory, migration, "migration.sql")).text()
    for (const statement of ddl.split("--> statement-breakpoint")) {
      const table = /^CREATE TABLE (`\w+`)/.exec(statement.trim())?.[1]
      if (table) await pool.query(`DROP TABLE IF EXISTS ${table}`)
      // The existing timestamp helper embeds ON UPDATE in its default SQL; unwrap it for local MySQL.
      await pool.query(
        statement.replaceAll(
          "DEFAULT (CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3))",
          "DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)",
        ),
      )
    }
    await rm(directory, { recursive: true })
    await db.execute(sql`drop table if exists go_quota_repair`)
    await pool.query(
      await Bun.file(new URL("../migrations/20260827122435_go_quota_repair/migration.sql", import.meta.url)).text(),
    )
  }, 60_000)

  beforeEach(async () => {
    await db.execute(sql`drop trigger if exists fail_quota_receipt`)
    for (const table of [
      GoQuotaRepairTable,
      LiteTable,
      BillingTable,
      UserTable,
      AuthTable,
      AccountTable,
      WorkspaceTable,
    ])
      await db.delete(table)
    await db.insert(WorkspaceTable).values({ id: input.workspaceID, name: "Quota fixture" })
    await db.insert(AccountTable).values({ id: "acc_quota_fixture" })
    await db.insert(AuthTable).values({
      id: "aut_quota_fixture",
      provider: "email",
      subject: input.email,
      accountID: "acc_quota_fixture",
    })
    await db.insert(UserTable).values({
      id: input.userID,
      workspaceID: input.workspaceID,
      accountID: "acc_quota_fixture",
      name: "Quota fixture",
      role: "member",
    })
    await db.insert(BillingTable).values({
      id: "bil_quota_fixture",
      workspaceID: input.workspaceID,
      balance: 12345,
      customerID: input.customerID,
      liteSubscriptionID: input.subscriptionID,
      lite: {},
    })
    await db.insert(LiteTable).values({
      id: input.liteID,
      workspaceID: input.workspaceID,
      userID: input.userID,
      timeCreated: new Date(input.timeCreated),
      monthlyUsage: input.expectedMonthlyUsage,
      timeMonthlyUpdated: new Date(input.expectedTimeMonthlyUpdated),
      rollingUsage: 20,
      weeklyUsage: 30,
      timeRollingUpdated: new Date(input.expectedTimeMonthlyUpdated),
      timeWeeklyUpdated: new Date(input.expectedTimeMonthlyUpdated),
    })
  })

  afterAll(async () => {
    await pool.end()
  })

  test("repairs only monthly usage and saves the exact receipt", async () => {
    const [before] = await db.select().from(LiteTable)
    const billing = await db.select().from(BillingTable)
    const result = await GoQuotaRepair.repair(input, deps)
    expect(result).toEqual({
      status: "repaired",
      receiptId: expect.any(String),
      workspaceID: input.workspaceID,
      liteID: input.liteID,
      subscriptionID: input.subscriptionID,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      previousMonthlyUsage: 900,
      monthlyUsage: 100,
      timeMonthlyUpdated: input.expectedTimeMonthlyUpdated,
    })
    const [after] = await db.select().from(LiteTable)
    expect(after).toEqual({ ...before, monthlyUsage: 100, timeUpdated: after.timeUpdated })
    expect(await db.select().from(BillingTable)).toEqual(billing)
    const [receipt] = await db.select().from(GoQuotaRepairTable)
    expect(receipt.input).toEqual(input)
    expect(receipt.result).toEqual(result)
  })

  test.each([
    { monthlyUsage: 901 },
    { monthlyUsage: null },
    { timeMonthlyUpdated: new Date("2026-08-20T09:00:00.457Z") },
    { timeMonthlyUpdated: null },
    { timeCreated: new Date("2026-01-15T08:00:00.124Z") },
    { userID: "usr_different_fixture" },
  ])("rejects stale quota row %j", async (change) => {
    await db.update(LiteTable).set(change)
    await expect(GoQuotaRepair.repair(input, deps)).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(0)
  })

  test.each([
    { email: "other@example.invalid" },
    { userID: "usr_different_fixture" },
    { workspaceID: "wrk_different_fixture" },
    { liteID: "lit_different_fixture" },
    { customerID: "cus_different_fixture" },
    { subscriptionID: "sub_different_fixture" },
  ])("rejects mismatched requester or binding %j", async (change) => {
    await expect(GoQuotaRepair.repair({ ...input, ...change }, deps)).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    expect((await db.select().from(LiteTable))[0].monthlyUsage).toBe(900)
  })

  test.each([LiteTable, BillingTable, UserTable, AuthTable, AccountTable, WorkspaceTable])(
    "rejects soft-deleted membership and binding rows",
    async (table) => {
      await db.update(table).set({ timeDeleted: deps.now() })
      await expect(GoQuotaRepair.repair(input, deps)).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    },
  )

  test("revalidates database bindings after the Stripe lookup", async () => {
    await expect(
      GoQuotaRepair.repair(input, {
        ...deps,
        subscription: async () => {
          await db.update(BillingTable).set({ liteSubscriptionID: "sub_replaced_fixture" })
          return subscription
        },
      }),
    ).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(0)
  })

  test.each(["2026-09-15T08:00:00.123Z", "2026-08-15T08:00:00.122Z"])(
    "rejects an expired frozen window at %s",
    async (now) => {
      await expect(GoQuotaRepair.repair(input, { ...deps, now: () => new Date(now) })).rejects.toBeInstanceOf(
        GoQuotaRepair.Conflict,
      )
    },
  )

  test.each(["2026-08-15T08:00:00.122Z", "2026-09-15T08:00:00.123Z", "2026-08-28T00:00:00.000Z"])(
    "rejects timestamps outside the active snapshot at %s",
    async (updated) => {
      await db.update(LiteTable).set({ timeMonthlyUpdated: new Date(updated) })
      await expect(
        GoQuotaRepair.repair({ ...input, expectedTimeMonthlyUpdated: updated }, deps),
      ).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    },
  )

  test.each(["canceled", "past_due", "trialing", "incomplete"] as const)("rejects Stripe status %s", async (status) => {
    await expect(
      GoQuotaRepair.repair(input, { ...deps, subscription: async () => ({ ...subscription, status }) }),
    ).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
  })

  test.each([{ id: "sub_other_fixture" }, { customer: "cus_other_fixture" }])(
    "rejects a changed Stripe binding %j",
    async (change) => {
      await expect(
        GoQuotaRepair.repair(input, { ...deps, subscription: async () => ({ ...subscription, ...change }) }),
      ).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    },
  )

  test.each([{ id: "price_other_fixture" }, { product: "prod_other_fixture" }, { recurring: null }])(
    "rejects a different Stripe Go price %j",
    async (price) => {
      await expect(
        GoQuotaRepair.repair(input, {
          ...deps,
          subscription: async () => ({
            ...subscription,
            items: { data: [{ price: { ...subscription.items.data[0].price, ...price } }] },
          }),
        }),
      ).rejects.toBeInstanceOf(GoQuotaRepair.Conflict)
    },
  )

  test("accepts the configured INR Go product price", async () => {
    const result = await GoQuotaRepair.repair(input, {
      ...deps,
      subscription: async () => ({
        ...subscription,
        items: {
          data: [
            {
              price: {
                ...subscription.items.data[0].price,
                id: "price_inr_fixture",
                currency: "inr",
                unit_amount: deps.go.priceInr,
              },
            },
          ],
        },
      }),
    })
    expect(result.status).toBe("repaired")
  })

  test("same-key replay never resets later usage, even after the period and subscription change", async () => {
    const result = await GoQuotaRepair.repair(input, deps)
    await db.update(LiteTable).set({ monthlyUsage: 750, timeMonthlyUpdated: new Date("2026-10-20T00:00:00.000Z") })
    await db.update(BillingTable).set({ liteSubscriptionID: null })
    const replay = await GoQuotaRepair.repair(input, {
      ...deps,
      now: () => new Date("2026-10-27T12:00:00.000Z"),
      subscription: async () => {
        throw new Error("Replay must not query Stripe")
      },
    })
    expect(replay).toEqual(result)
    expect((await db.select().from(LiteTable))[0].monthlyUsage).toBe(750)
  })

  test("same key with changed input conflicts", async () => {
    await GoQuotaRepair.repair(input, deps)
    await expect(GoQuotaRepair.repair({ ...input, monthlyUsage: 0 }, deps)).rejects.toBeInstanceOf(
      GoQuotaRepair.Conflict,
    )
  })

  test("replays a concurrently completed receipt even when the Stripe lookup fails", async () => {
    const result = await GoQuotaRepair.repair(input, {
      ...deps,
      subscription: async () => {
        await GoQuotaRepair.repair(input, deps)
        throw new Error("Fixture Stripe failure after concurrent completion")
      },
    })
    expect(result).toEqual((await db.select().from(GoQuotaRepairTable))[0].result!)
    expect((await db.select().from(LiteTable))[0].monthlyUsage).toBe(100)
  })

  test("concurrent duplicate requests return one original receipt", async () => {
    const results = await Promise.all(Array.from({ length: 4 }, () => GoQuotaRepair.repair(input, deps)))
    for (const result of results) expect(result).toEqual(results[0])
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(1)
    expect((await db.select().from(LiteTable))[0].monthlyUsage).toBe(100)
  })

  test("concurrent different keys cannot both consume the same snapshot", async () => {
    const results = await Promise.allSettled([
      GoQuotaRepair.repair(input, deps),
      GoQuotaRepair.repair({ ...input, idempotencyKey: "second-fixture" }, deps),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1)
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(1)
  })

  test("concurrent same-key requests with different input conflict", async () => {
    const results = await Promise.allSettled([
      GoQuotaRepair.repair(input, deps),
      GoQuotaRepair.repair({ ...input, monthlyUsage: 0 }, deps),
    ])
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    const failure = results.find((result) => result.status === "rejected")
    expect(failure?.status === "rejected" && failure.reason).toBeInstanceOf(GoQuotaRepair.Conflict)
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(1)
  })

  test("receipt persistence failure rolls back the counter and the claim", async () => {
    await db.execute(sql`create trigger fail_quota_receipt before update on go_quota_repair
      for each row signal sqlstate '45000' set message_text = 'Fixture receipt failure'`)
    await expect(GoQuotaRepair.repair(input, deps)).rejects.toThrow()
    expect((await db.select().from(LiteTable))[0].monthlyUsage).toBe(900)
    expect(await db.select().from(GoQuotaRepairTable)).toHaveLength(0)
    await db.execute(sql`drop trigger fail_quota_receipt`)
    expect((await GoQuotaRepair.repair(input, deps)).status).toBe("repaired")
  })
})
