import { describe, expect, test } from "bun:test"
import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client/promise"
import { modelUsage, usageView } from "./limits"

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

const opus = { providerID: "opencode", modelID: "claude-opus-5", name: "Claude Opus 5" }
const sonnet = { providerID: "opencode", modelID: "claude-sonnet-5", name: "Claude Sonnet 5" }
const served = (id: string, provider = "opencode") => ({ id, provider: { id: provider, integrationID: "opencode" } })

describe("modelUsage", () => {
  test("covers a model by every budget that counts it and keeps the least left", () => {
    const limits = info(
      budget({ id: "all", limit: 500, spent: 100 }),
      budget({
        id: "anthropic",
        coverage: "models",
        per: "model",
        limit: 50,
        spent: 50,
        vendors: ["Anthropic"],
        models: [
          { ...opus, spent: 50 },
          { ...sonnet, spent: 20 },
        ],
      }),
    )

    expect(modelUsage(limits, served("claude-sonnet-5"))).toEqual({ left: 30, reached: false, resetsAt: RESET })
    expect(modelUsage(limits, served("claude-opus-5"))).toEqual({ left: 0, reached: true, resetsAt: RESET })
    // A budget on all spend covers models served through the workspace, but not OpenCode Go or a direct provider.
    expect(modelUsage(limits, served("gpt-6-sol", "console-openai"))).toEqual({
      left: 400,
      reached: false,
      resetsAt: RESET,
    })
    expect(modelUsage(limits, served("glm-5.3", "opencode-go"))).toBeUndefined()
    expect(modelUsage(limits, { id: "claude-opus-5", provider: { id: "anthropic" } })).toBeUndefined()
  })
})

describe("usageView", () => {
  test("orders budgets by what stops the member first", () => {
    const view = usageView(
      info(budget({ id: "roomy", limit: 500, spent: 10 }), budget({ id: "tight", limit: 150, spent: 123.14 })),
    )

    expect(view.budgets.map((row) => [row.id, row.notes])).toEqual([
      ["tight", [{ kind: "runs-out-first" }]],
      ["roomy", []],
    ])
    expect(view.budgets[0]).toMatchObject({ left: 26.86, reached: false })
    expect(view.footer).toEqual({ kind: "resets", resetsAt: RESET })
    expect(view.callout).toBeUndefined()
  })

  test("explains a reached budget on all spend and pauses the rest", () => {
    const view = usageView(
      info(
        budget({ id: "models", coverage: "models", limit: 50, spent: 5, vendors: ["Anthropic"], models: [opus] }),
        budget({ id: "pool", scope: "combined", shared: true, limit: 150, spent: 150.42 }),
      ),
    )

    expect(view.callout).toEqual({ kind: "workspace", resetsAt: RESET })
    expect(view.dimmed).toBe(true)
    expect(view.action).toBeUndefined()
    expect(view.budgets.map((row) => [row.id, row.sharing, row.notes])).toEqual([
      ["pool", "everyone", [{ kind: "includes-web-search" }]],
      ["models", "you", [{ kind: "paused-by", shared: true }]],
    ])
  })

  test("offers other models when a budget on some models is reached", () => {
    const vendors = usageView(
      info(budget({ id: "anthropic", coverage: "models", limit: 50, spent: 50, vendors: ["Anthropic"] })),
    )

    expect(vendors.callout).toBeUndefined()
    expect(vendors.budgets[0].notes).toEqual([{ kind: "paused" }])
    expect(vendors.action).toEqual({ kind: "other-models", vendors: ["Anthropic"] })

    // A budget per model counts the model in use, and suggests the covered model with the most room.
    const each = usageView(
      info(
        budget({
          id: "each",
          coverage: "models",
          per: "model",
          limit: 20,
          spent: 20,
          picked: true,
          models: [
            { ...opus, spent: 20 },
            { ...sonnet, spent: 5 },
          ],
        }),
      ),
      { model: opus },
    )

    expect(each.budgets[0]).toMatchObject({
      label: { kind: "models", names: ["Claude Opus 5", "Claude Sonnet 5"], each: true },
      reached: true,
      notes: [{ kind: "current-model", name: "Claude Opus 5" }],
    })
    expect(each.action).toEqual({
      kind: "other-models-each",
      vendors: [],
      limit: 20,
      suggestion: { name: "Claude Sonnet 5", left: 15 },
    })
  })

  test("blames the workspace's credits over its budgets", () => {
    const view = usageView(info(budget({ id: "all", limit: 100, spent: 10 })), { credits: true })

    expect(view.callout).toEqual({ kind: "credits" })
    expect(view.footer).toEqual({ kind: "budgets-reset", resetsAt: RESET })
    expect(usageView(info(), { credits: true }).footer).toEqual({ kind: "credits-only" })
  })
})
