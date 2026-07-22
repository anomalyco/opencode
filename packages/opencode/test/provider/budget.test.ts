import { describe, test, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { eq } from "drizzle-orm"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Database } from "@opencode-ai/core/database/database"
import { UserIdentityTable, TokenBalanceTable, TokenTransactionTable } from "@opencode-ai/core/account/sql"
import { Budget } from "../../src/provider/budget"
import { Provider } from "../../src/provider/provider"

// --- Helpers ---

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

async function run<R>(effect: Effect.Effect<R, any, any>, withZen = true) {
  const layer = buildLayer(withZen)
  const provided = Effect.provide(effect, layer) as Effect.Effect<R, any, never>
  return Effect.runPromise(provided)
}

// --- Tests ---

describe("Budget.Service", () => {
  describe("isFreeModel", () => {
    test("opencode -> true", () => expect(Budget.isFreeModel("opencode")).toBe(true))
    test("opencode-dev -> true", () => expect(Budget.isFreeModel("opencode-dev")).toBe(true))
    test("anthropic -> false", () => expect(Budget.isFreeModel("anthropic")).toBe(false))
    test("google -> false", () => expect(Budget.isFreeModel("google")).toBe(false))
  })

  describe("resolveModel", () => {
    test("free model -> action: free", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      const result = await run(Effect.gen(function* () {
        const budget = yield* Budget.Service
        return yield* budget.resolveModel({
          userId: "u", modelId: ModelV2.ID.make("m"), providerID: ProviderV2.ID.make("opencode"),
        })
      }))
      expect(result.action).toBe("free")
    })

    test("paid model + sufficient balance -> paid", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 1000)
        const budget = yield* Budget.Service
        const result = yield* budget.resolveModel({
          userId: "u", modelId: ModelV2.ID.make("gpt-4"), providerID: ProviderV2.ID.make("openai"),
        })
        expect(result.action).toBe("paid")
      }))
    })

    test("paid + zero balance + Zen available -> swapped", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      const result = await run(Effect.gen(function* () {
        const budget = yield* Budget.Service
        return yield* budget.resolveModel({
          userId: "u", modelId: ModelV2.ID.make("gpt-4"), providerID: ProviderV2.ID.make("openai"),
        })
      }))
      expect(result.action).toBe("swapped")
      expect(result.modelId).toBe(ModelV2.ID.make("claude-opus-4-6"))
      expect(result.originalModelId).toBe(ModelV2.ID.make("gpt-4"))
    })

    test("paid + zero balance + NO Zen -> BudgetExhaustedError", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      const error = await run(Effect.gen(function* () {
        const budget = yield* Budget.Service
        return yield* Effect.flip(budget.resolveModel({
          userId: "u", modelId: ModelV2.ID.make("gpt-4"), providerID: ProviderV2.ID.make("openai"),
        }))
      }), false)
      expect(error._tag).toBe("BudgetExhaustedError")
    })

    test("disabled when env unset -> free", async () => {
      delete process.env["OPENCODE_TOKEN_MGMT"]
      const result = await run(Effect.gen(function* () {
        const budget = yield* Budget.Service
        return yield* budget.resolveModel({
          userId: "u", modelId: ModelV2.ID.make("gpt-4"), providerID: ProviderV2.ID.make("openai"),
        })
      }))
      expect(result.action).toBe("free")
    })
  })

  describe("deduct", () => {
    test("decreases balance and records transaction", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 1000, 50)
        const budget = yield* Budget.Service
        yield* budget.deduct({
          userId: "u", amount: -50,
          model: ModelV2.ID.make("gpt-4"),
          providerID: ProviderV2.ID.make("openai"),
          tokensUsed: 1000, costUsd: 0.00015, sessionId: "s1",
        })
        const { db } = yield* Database.Service
        const bal = yield* db.select().from(TokenBalanceTable).where(eq(TokenBalanceTable.userId, "u")).get()
        expect(bal!.balance).toBe(950)
        expect(bal!.lifetimeUsed).toBe(1050)
        const tx = yield* db.select().from(TokenTransactionTable).where(eq(TokenTransactionTable.userId, "u")).get()
        expect(tx).not.toBeNull()
        expect(tx!.amount).toBe(-50)
        expect(tx!.model).toBe("gpt-4")
        expect(tx!.sessionId).toBe("s1")
      }))
    })

    test("allows negative balance", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 10)
        yield* (yield* Budget.Service).deduct({
          userId: "u", amount: -100,
          model: ModelV2.ID.make("gpt-4"),
          providerID: ProviderV2.ID.make("openai"),
          tokensUsed: 2000, costUsd: 0.0003,
        })
        const { db } = yield* Database.Service
        const bal = yield* db.select().from(TokenBalanceTable).where(eq(TokenBalanceTable.userId, "u")).get()
        expect(bal!.balance).toBe(-90)
      }))
    })

    test("free model skips deduction", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 500)
        yield* (yield* Budget.Service).deduct({
          userId: "u", amount: -50,
          model: ModelV2.ID.make("m"),
          providerID: ProviderV2.ID.make("opencode"),
          tokensUsed: 500, costUsd: 0.0001,
        })
        const { db } = yield* Database.Service
        const bal = yield* db.select().from(TokenBalanceTable).where(eq(TokenBalanceTable.userId, "u")).get()
        expect(bal!.balance).toBe(500)
      }))
    })

    test("disabled when env unset -> no-op", async () => {
      delete process.env["OPENCODE_TOKEN_MGMT"]
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 500)
        yield* (yield* Budget.Service).deduct({
          userId: "u", amount: -50,
          model: ModelV2.ID.make("gpt-4"),
          providerID: ProviderV2.ID.make("openai"),
          tokensUsed: 1000, costUsd: 0.00015,
        })
        const { db } = yield* Database.Service
        const bal = yield* db.select().from(TokenBalanceTable).where(eq(TokenBalanceTable.userId, "u")).get()
        expect(bal!.balance).toBe(500)
      }))
    })
  })

  describe("check", () => {
    test("passes when balance > 0", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* insertUser("u")
        yield* insertBalance("u", 100)
        yield* (yield* Budget.Service).check({ userId: "u", estimatedCost: 50 })
      }))
    })

    test("fails when balance = 0", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      const error = await run(Effect.gen(function* () {
        return yield* Effect.flip((yield* Budget.Service).check({ userId: "u", estimatedCost: 50 }))
      }))
      expect(error._tag).toBe("BudgetExhaustedError")
    })

    test("passes when disabled", async () => {
      delete process.env["OPENCODE_TOKEN_MGMT"]
      await run(Effect.gen(function* () {
        yield* (yield* Budget.Service).check({ userId: "u", estimatedCost: 999999 })
      }))
    })
  })

  describe("credit", () => {
    test("no-op placeholder", async () => {
      process.env["OPENCODE_TOKEN_MGMT"] = "1"
      await run(Effect.gen(function* () {
        yield* (yield* Budget.Service).credit({ userId: "u", amount: 100, description: "test" })
      }))
    })
  })
})
