import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client"
import {
  formatDollars,
  formatReset,
  limitScope,
  modelUsage,
  refusalReset,
  usageLevel,
} from "../../src/util/usage-limits"

const RESET = Date.UTC(2026, 10, 1)

const budget = (input: Partial<UsageLimitsBudget> & Pick<UsageLimitsBudget, "id">): UsageLimitsBudget => ({
  limit: 100,
  spent: 0,
  scope: "each",
  per: "set",
  coverage: "all",
  models: [],
  vendors: [],
  picked: false,
  shared: false,
  resetsAt: RESET,
  ...input,
})

const info = (...budgets: UsageLimitsBudget[]): UsageLimitsInfo => ({
  workspace: { id: "wrk_1", name: "Acme", usageURL: "https://opencode.ai/wrk_1/activity/overview" },
  budgets,
})

// One request that fills Sol's context costs $4, so $12 covers three.
const sol = { id: "gpt-5.6-sol", providerID: "opencode", cost: [{ input: 4 }], limit: { context: 1_000_000 } }
const served = { id: "opencode", integrationID: "opencode" }

afterEach(() => setSystemTime())

describe("util.usage-limits", () => {
  test("the limit closest to running out sets what a model has left", () => {
    const limits = info(
      budget({ id: "all", limit: 500, spent: 100 }),
      budget({
        id: "each",
        coverage: "models",
        per: "model",
        limit: 50,
        spent: 50,
        models: [
          { providerID: "opencode", modelID: "gpt-5.6-sol", name: "GPT 5.6 Sol", spent: 20 },
          { providerID: "opencode", modelID: "claude-opus-5", name: "Claude Opus 5", spent: 50 },
        ],
      }),
    )

    expect(modelUsage(limits, sol, served)).toMatchObject({
      left: 30,
      reached: false,
      resetsAt: RESET,
      limits: [
        { budget: { id: "each" }, spent: 20 },
        { budget: { id: "all" }, spent: 100 },
      ],
    })
    expect(modelUsage(limits, { ...sol, id: "claude-opus-5" }, served)).toMatchObject({ left: 0, reached: true })
    // Spend on all models covers what OpenCode Console serves, but not OpenCode Go, a direct provider or a free model.
    expect(
      modelUsage(limits, { ...sol, providerID: "opencode-go" }, { id: "opencode-go", integrationID: "opencode" }),
    ).toBeUndefined()
    expect(modelUsage(limits, { ...sol, providerID: "openai" }, { id: "openai" })).toBeUndefined()
    expect(modelUsage(limits, { ...sol, cost: [{ input: 0 }] }, served)).toBeUndefined()
  })

  test("warns by how many full requests are left on the model", () => {
    const level = (spent: number) => usageLevel(modelUsage(info(budget({ id: "all", spent })), sol, served)!, sol)

    expect(level(80)).toBe("plenty")
    expect(level(90)).toBe("low")
    expect(level(97)).toBe("out")
    expect(level(100)).toBe("reached")
  })

  test("writes dollars and resets the way limits read", () => {
    expect([6, 1.2, 0.004, 0, 1240].map(formatDollars)).toEqual(["$6", "$1.20", "<$0.01", "$0", "$1,240"])

    setSystemTime(new Date(2026, 9, 24, 9))
    expect(formatReset(new Date(2026, 9, 24, 17).getTime())).toBe("5:00 PM today")
    expect(formatReset(new Date(2026, 10, 1).getTime())).toBe("Nov 1")
    expect(formatReset(new Date(2026, 9, 31, 19).getTime())).toBe("Oct 31, 7:00 PM")
  })

  test("says who spends from a limit and which models it pools", () => {
    expect(limitScope(budget({ id: "a", coverage: "models", vendors: ["OpenAI"] }), "Acme")).toBe(
      "Only you · All OpenAI models",
    )
    expect(limitScope(budget({ id: "b", scope: "combined", shared: true }), "Acme")).toBe(
      "Everyone in Acme · All models",
    )
    expect(limitScope(budget({ id: "c", scope: "combined", coverage: "models", inputPriceAtLeast: 3 }), "Acme")).toBe(
      "You and others · Models over $3 per 1M",
    )
    expect(
      limitScope(
        budget({
          id: "d",
          coverage: "models",
          picked: true,
          models: ["A", "B", "C", "D"].map((name) => ({ providerID: "opencode", modelID: name, name })),
        }),
        "Acme",
      ),
    ).toBe("Only you · A, B, C +1 more")
    expect(limitScope(budget({ id: "e", coverage: "models", per: "model", vendors: ["OpenAI"] }), "Acme")).toBe(
      "Only you",
    )
  })

  test("reads when a refused request's limit resets from either error envelope", () => {
    const at = "2026-11-01T00:00:00.000Z"
    expect(
      refusalReset({
        response: { body: JSON.stringify({ type: "error", error: {}, metadata: { coverage: "all", resetsAt: at } }) },
      }),
    ).toBe(RESET)
    expect(
      refusalReset({
        response: {
          body: JSON.stringify({
            error: {
              code: 429,
              details: [{ reason: "BudgetLimitError", metadata: { coverage: "models", resetsAt: at } }],
            },
          }),
        },
      }),
    ).toBe(RESET)
    expect(refusalReset({ response: { body: "{}" } })).toBeUndefined()
  })
})
