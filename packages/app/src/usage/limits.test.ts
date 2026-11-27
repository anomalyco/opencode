import { describe, expect, test } from "bun:test"
import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client/promise"
import { modelBadge, modelUsage, usageBlock, usageLevel, usageView } from "./limits"

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

const opusModel = {
  id: "claude-opus-5",
  provider: { id: "opencode", integrationID: "opencode" },
  cost: { input: 5 },
  limit: { context: 200_000 },
}

describe("usageLevel", () => {
  test("measures what is left in full-context requests on the model", () => {
    // A full-context request on this model costs $1.
    expect(usageLevel({ left: 3, reached: false, resetsAt: RESET }, opusModel)).toBe("plenty")
    expect(usageLevel({ left: 2.5, reached: false, resetsAt: RESET }, opusModel)).toBe("low")
    expect(usageLevel({ left: 0.5, reached: false, resetsAt: RESET }, opusModel)).toBe("out")
    expect(usageLevel({ left: 0, reached: true, resetsAt: RESET }, opusModel)).toBe("reached")
  })
})

describe("modelBadge", () => {
  test("names a free model, and what is left only when it covers fewer than three full-context requests", () => {
    expect(modelBadge(undefined, { free: false, info: undefined })).toBeUndefined()
    expect(modelBadge(opusModel, { free: true, info: undefined })).toEqual({ kind: "free" })
    expect(modelBadge(opusModel, { free: false, info: info(budget({ id: "all", spent: 97 })) })).toBeUndefined()
    expect(modelBadge(opusModel, { free: false, info: info(budget({ id: "all", spent: 98 })) })).toEqual({
      kind: "left",
      left: 2,
    })
    expect(modelBadge(opusModel, { free: false, info: info(budget({ id: "all", spent: 99.5 })) })).toEqual({
      kind: "left",
      left: 0.5,
    })
    // A reached budget shows no badge.
    expect(modelBadge(opusModel, { free: false, info: info(budget({ id: "all", spent: 100 })) })).toBeUndefined()
    const direct = { ...opusModel, provider: { id: "anthropic" } }
    expect(modelBadge(direct, { free: false, info: info(budget({ id: "all", spent: 98 })) })).toBeUndefined()
  })
})

describe("usageBlock", () => {
  const now = RESET - 86_400_000

  test("reads a reached budget from the usage limits, but not a Go window", () => {
    expect(usageBlock({ model: opusModel, free: false, info: info(budget({ id: "all", spent: 100 })), now })).toEqual({
      kind: "workspace",
      resetsAt: RESET,
    })
    const perModel = budget({
      id: "anthropic",
      coverage: "models",
      per: "model",
      limit: 50,
      models: [{ ...opus, spent: 50 }],
    })
    expect(usageBlock({ model: opusModel, free: false, info: info(perModel), now })).toEqual({
      kind: "model",
      resetsAt: RESET,
    })
    expect(usageBlock({ model: opusModel, free: false, info: info(perModel), now: RESET })).toBeUndefined()
    expect(usageBlock({ model: opusModel, free: true, info: info(perModel), now })).toBeUndefined()

    const goModel = { ...opusModel, id: "glm-5", provider: { id: "opencode-go", integrationID: "opencode" } }
    const limited = {
      ...info(),
      go: {
        rolling: { percent: 100, limited: true, resetsAt: now + 3_600_000 },
        weekly: { percent: 100, limited: true, resetsAt: now + 3 * 86_400_000 },
        monthly: { percent: 60, limited: false, resetsAt: RESET },
      },
    }
    expect(usageBlock({ model: goModel, free: false, info: limited, now })).toBeUndefined()
    const refused = {
      model: { providerID: "opencode-go", id: "glm-5" },
      time: { created: now },
      error: {
        type: "provider.go-limit",
        retryAfterMs: 3_600_000,
        response: { body: JSON.stringify({ metadata: { limitName: "5 hour" } }) },
      },
    }
    expect(usageBlock({ model: goModel, free: false, info: limited, last: refused, now })).toEqual({
      kind: "go",
      window: "rolling",
      resetsAt: now + 3_600_000,
    })
    // A direct provider is never limited by the workspace.
    const direct = { ...opusModel, provider: { id: "anthropic" } }
    expect(
      usageBlock({ model: direct, free: false, info: info(budget({ id: "all", spent: 100 })), now }),
    ).toBeUndefined()
  })

  test("holds a refusal for the model that was refused, until it resets", () => {
    const last = {
      model: { providerID: "opencode", id: "claude-opus-5" },
      time: { created: now },
      error: {
        type: "provider.go-limit",
        retryAfterMs: 3_600_000,
        response: { body: JSON.stringify({ metadata: { limitName: "weekly" } }) },
      },
    }
    expect(usageBlock({ model: opusModel, free: false, info: undefined, last, now })).toEqual({
      kind: "go",
      window: "weekly",
      resetsAt: now + 3_600_000,
    })
    expect(usageBlock({ model: opusModel, free: false, info: undefined, last, now: now + 3_600_000 })).toBeUndefined()
    const other = { ...opusModel, id: "claude-sonnet-5" }
    expect(usageBlock({ model: other, free: false, info: undefined, last, now })).toBeUndefined()

    // A refusal that doesn't say when it resets holds for an hour.
    const credits = { ...last, error: { type: "provider.quota", status: 402 } }
    expect(usageBlock({ model: opusModel, free: false, info: undefined, last: credits, now })).toEqual({
      kind: "credits",
    })
    expect(
      usageBlock({ model: opusModel, free: false, info: undefined, last: credits, now: now + 3_600_000 }),
    ).toBeUndefined()
    const direct = { ...opusModel, provider: { id: "anthropic" } }
    const directCredits = { ...credits, model: { providerID: "anthropic", id: "claude-opus-5" } }
    expect(usageBlock({ model: direct, free: false, info: undefined, last: directCredits, now })).toBeUndefined()
  })
})
