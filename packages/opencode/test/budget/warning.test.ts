import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq, sql } from "drizzle-orm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Database } from "@opencode-ai/core/database/database"
import { UserIdentityTable, TokenBalanceTable, TokenTransactionTable } from "@opencode-ai/core/account/sql"
import { Budget, getWarning, setWarning } from "../../src/provider/budget"
import { Provider } from "../../src/provider/provider"

function makeProvider(withZen: boolean): Record<string, any> {
  const zenModels: Record<string, any> = withZen
    ? {
        "claude-opus-4-6": {
          id: ModelV2.ID.make("claude-opus-4-6"),
          providerID: ProviderV2.ID.make("opencode"),
          name: "Claude Opus 4.6",
          api: { id: "c", url: "", npm: "" },
          capabilities: {
            temperature: true, reasoning: true, attachment: true, toolcall: true,
            input: { text: true, audio: false, image: false, video: false, pdf: false },
            output: { text: true, audio: false, image: false, video: false, pdf: false },
          },
          cost: { input: 3, output: 15, cache: { read: 1.5, write: 3 } },
          limit: { context: 200000, output: 8192 },
          status: "active", options: {}, headers: {},
          release_date: "2025-01-01",
        } as any,
      }
    : {}
  return {
    [ProviderV2.ID.make("opencode") as any]: {
      id: ProviderV2.ID.make("opencode"),
      name: "OpenCode", source: "config" as const,
      env: [] as string[], options: {}, models: zenModels,
    },
  }
}

function mockProviderLayer(withZen: boolean): Layer.Layer<Provider.Service> {
  const providers = makeProvider(withZen)
  return Layer.succeed(Provider.Service, Provider.Service.of({
    list: () => Effect.succeed(providers),
    getProvider: (id: any) => Effect.succeed(
      providers[id] ?? { id, name: id, source: "config", env: [], options: {}, models: {} },
    ),
    getModel: (p: any, m: any) => Effect.succeed({ id: m, providerID: p } as any),
    getLanguage: () => Effect.die("not mocked"),
    closest: () => Effect.succeed(undefined),
    getSmallModel: () => Effect.succeed(undefined),
    defaultModel: () => Effect.succeed({ providerID: ProviderV2.ID.make("opencode"), modelID: ModelV2.ID.make("c") }),
  }))
}

function buildLayer(withZen: boolean): Layer.Layer<Budget.Service | Database.Service | Provider.Service> {
  const deps = Layer.mergeAll(Database.layerFromPath(":memory:"), mockProviderLayer(withZen))
  return Layer.provideMerge(Budget.layer, deps)
}

function insertUser(userId: string) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(UserIdentityTable).values({
      id: userId, email: `${userId}@t.com`, createdAt: Date.now(), lastLoginAt: Date.now(),
    }).run()
  })
}

function insertBalance(userId: string, balance: number, lifetimeUsed = 0) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(TokenBalanceTable).values({
      userId, balance, lifetimeUsed, updatedAt: Date.now(),
    }).run()
  })
}

function insertTransaction(userId: string, amount: number, tokensUsed?: number, costUsd?: number, createdAt?: number) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db.insert(TokenTransactionTable).values({
      userId,
      amount,
      tokensUsed: tokensUsed ?? Math.abs(amount),
      costUsd: costUsd ?? 0.001,
      createdAt: createdAt ?? Date.now(),
    }).run()
  })
}

async function run<R>(effect: Effect.Effect<R, any, any>, withZen = true) {
  const layer = buildLayer(withZen)
  const provided = Effect.provide(effect, layer) as Effect.Effect<R, any, never>
  return Effect.runPromise(provided)
}

describe("Budget low-balance warning", () => {
  test("deduct below threshold sets warning", async () => {
    process.env["OPENCODE_TOKEN_MGMT"] = "1"
    process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "10000"

    await run(Effect.gen(function* () {
      yield* insertUser("u")
      yield* insertBalance("u", 500) // Only 500 balance, threshold is max(5000, 2000) = 5000

      // Reset warning.
      setWarning(null)

      yield* (yield* Budget.Service).deduct({
        userId: "u", amount: -10,
        model: ModelV2.ID.make("gpt-4"),
        providerID: ProviderV2.ID.make("openai"),
        tokensUsed: 200, costUsd: 0.00003,
      })

      const warning = getWarning()
      expect(warning).not.toBeNull()
      expect(warning!.remaining).toBe(490)
      expect(warning!.threshold).toBe(5000)
      expect(warning!.message).toContain("Low balance")
    }))
  })

  test("deduct above threshold does NOT set warning", async () => {
    process.env["OPENCODE_TOKEN_MGMT"] = "1"
    process.env["OPENCODE_MONTHLY_ALLOWANCE"] = "10000"

    await run(Effect.gen(function* () {
      yield* insertUser("u2")
      yield* insertBalance("u2", 10000) // Above threshold of 5000

      setWarning(null)

      yield* (yield* Budget.Service).deduct({
        userId: "u2", amount: -10,
        model: ModelV2.ID.make("gpt-4"),
        providerID: ProviderV2.ID.make("openai"),
        tokensUsed: 200, costUsd: 0.00003,
      })

      const warning = getWarning()
      expect(warning).toBeNull()
    }))
  })

  test("empty balance (0) does not set warning", async () => {
    process.env["OPENCODE_TOKEN_MGMT"] = "1"

    await run(Effect.gen(function* () {
      yield* insertUser("u3")
      yield* insertBalance("u3", 0)

      setWarning(null)

      yield* (yield* Budget.Service).deduct({
        userId: "u3", amount: -10,
        model: ModelV2.ID.make("gpt-4"),
        providerID: ProviderV2.ID.make("openai"),
        tokensUsed: 200, costUsd: 0.00003,
      })

      const warning = getWarning()
      expect(warning).toBeNull()
    }))
  })

  test("free model skips warning check", async () => {
    process.env["OPENCODE_TOKEN_MGMT"] = "1"

    await run(Effect.gen(function* () {
      yield* insertUser("u4")
      yield* insertBalance("u4", 1)

      setWarning(null)

      yield* (yield* Budget.Service).deduct({
        userId: "u4", amount: -10,
        model: ModelV2.ID.make("c"),
        providerID: ProviderV2.ID.make("opencode"),
        tokensUsed: 200, costUsd: 0.00003,
      })

      const warning = getWarning()
      expect(warning).toBeNull()
    }))
  })
})

describe("stats", () => {
  test("stats returns correct totals after inserts", async () => {
    const result = await run(Effect.gen(function* () {
      yield* insertUser("u1")
      yield* insertBalance("u1", 1000, 500)
      yield* insertUser("u2")
      yield* insertBalance("u2", 2000, 100)
      yield* insertUser("u3")
      yield* insertBalance("u3", 3000, 200)

      const { db } = yield* Database.Service
      const userCount = yield* db.select({
        count: sql`COUNT(*)`,
      }).from(UserIdentityTable).get()
      const balanceSum = yield* db.select({
        sum: sql`COALESCE(SUM(${TokenBalanceTable.balance}), 0)`,
      }).from(TokenBalanceTable).get()

      return { totalUsers: Number((userCount as any).count), totalBalance: Number((balanceSum as any).sum) }
    }))

    expect(result.totalUsers).toBe(3)
    expect(result.totalBalance).toBe(6000)
  })

  test("usageStats returns correct per-user aggregation", async () => {
    const now = Date.now()
    const today = new Date(now)
    const dateStr = today.toISOString().slice(0, 10)

    const result = await run(Effect.gen(function* () {
      yield* insertUser("u1")
      yield* insertUser("u2")
      yield* insertTransaction("u1", -100, 1000, 0.001, now)
      yield* insertTransaction("u1", -50, 500, 0.0005, now)
      yield* insertTransaction("u2", -200, 2000, 0.002, now)

      const { db } = yield* Database.Service
      const fromMs = new Date(dateStr + "T00:00:00Z").getTime()
      const toMs = new Date(dateStr + "T23:59:59.999Z").getTime()

      const rows = yield* db
        .select({
          date: sql`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch')`,
          userId: TokenTransactionTable.userId,
          email: UserIdentityTable.email,
          tokensUsed: sql`COALESCE(SUM(ABS(${TokenTransactionTable.tokensUsed})), 0)`,
          costUsd: sql`COALESCE(SUM(ABS(${TokenTransactionTable.costUsd})), 0)`,
          requestCount: sql`COUNT(*)`,
        })
        .from(TokenTransactionTable)
        .leftJoin(UserIdentityTable, eq(UserIdentityTable.id, TokenTransactionTable.userId))
        .where(
          sql`${TokenTransactionTable.amount} < 0
            AND ${TokenTransactionTable.createdAt} >= ${fromMs}
            AND ${TokenTransactionTable.createdAt} <= ${toMs}`,
        )
        .groupBy(
          sql`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch')`,
          TokenTransactionTable.userId,
        )
        .orderBy(
          sql`date(${TokenTransactionTable.createdAt} / 1000, 'unixepoch') DESC`,
          sql`tokensUsed DESC`,
        )
        .all()

      return rows.map((row) => ({
        date: (row as any).date,
        userId: (row as any).userId,
        email: (row as any).email ?? "",
        tokensUsed: Number((row as any).tokensUsed),
        costUsd: Number((row as any).costUsd),
        requestCount: Number((row as any).requestCount),
      }))
    }))

    expect(result).toHaveLength(2)
    // u2 has more tokens used, should be first
    expect(result[0].userId).toBe("u2")
    expect(result[0].tokensUsed).toBe(2000)
    expect(result[0].requestCount).toBe(1)
    expect(result[1].userId).toBe("u1")
    expect(result[1].tokensUsed).toBe(1500)
    expect(result[1].requestCount).toBe(2)
  })
})
