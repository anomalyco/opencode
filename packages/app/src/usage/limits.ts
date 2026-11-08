import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client/promise"

/** The model the member is using, so a per-model budget shows this model's own counter. */
export type CurrentModel = { readonly providerID: string; readonly modelID: string; readonly name: string }

/** What a budget counts, before it is put into words. */
export type BudgetLabel =
  | { readonly kind: "all" }
  | { readonly kind: "vendors"; readonly vendors: readonly string[]; readonly each: boolean; readonly price?: number }
  | { readonly kind: "price"; readonly price: number; readonly each: boolean }
  | { readonly kind: "models"; readonly names: readonly string[]; readonly each: boolean }
  | { readonly kind: "each" }

export type BudgetNote =
  | { readonly kind: "runs-out-first" }
  | { readonly kind: "paused" }
  | { readonly kind: "includes-web-search" }
  | { readonly kind: "paused-by"; readonly shared: boolean }
  | { readonly kind: "current-model"; readonly name: string }

export type BudgetRow = {
  readonly id: string
  readonly label: BudgetLabel
  readonly limit: number
  readonly perModel: boolean
  /** Who spends against it: the member alone, everyone in the workspace, or a group of members. */
  readonly sharing: "you" | "everyone" | "group"
  readonly notes: readonly BudgetNote[]
  readonly reached: boolean
  readonly spent: number
  readonly left: number
  /** How much of the limit is spent, from 0 to 1. */
  readonly fill: number
}

export type Callout =
  | { readonly kind: "credits" }
  | { readonly kind: "workspace" | "personal"; readonly resetsAt: number }

export type LimitAction =
  | { readonly kind: "other-models"; readonly vendors: readonly string[] }
  | {
      readonly kind: "other-models-each"
      readonly vendors: readonly string[]
      readonly limit: number
      /** The covered model with the most room left, to switch to. */
      readonly suggestion?: { readonly name: string; readonly left: number }
    }

export type Footer =
  | { readonly kind: "resets" | "budgets-reset"; readonly resetsAt: number }
  | { readonly kind: "credits-only" }

export type GoRow = {
  readonly window: "rolling" | "weekly" | "monthly"
  readonly percent: number
  readonly limited: boolean
  readonly resetsAt: number
}

export type UsageView = {
  readonly workspace: string | undefined
  readonly callout?: Callout
  readonly go?: readonly GoRow[]
  readonly budgets: readonly BudgetRow[]
  /** A callout explains why paid models are paused, so the budgets are shown as context. */
  readonly dimmed: boolean
  readonly action?: LimitAction
  readonly footer: Footer
}

/**
 * What the Usage dialog shows for a workspace's usage limits. Budgets are ordered by what stops the member first, the
 * least left. `credits` marks a workspace whose credits ran out.
 */
export function usageView(
  info: UsageLimitsInfo,
  context: { readonly model?: CurrentModel; readonly credits?: boolean } = {},
): UsageView {
  const budgets = info.budgets
    .map((budget) => ({ budget, ...spend(budget, context.model) }))
    .toSorted((a, b) => a.left - b.left)
  const blocking = budgets.find((entry) => entry.reached && entry.budget.coverage === "all")
  const callout: Callout | undefined = context.credits
    ? { kind: "credits" }
    : blocking && { kind: blocking.budget.shared ? "workspace" : "personal", resetsAt: blocking.budget.resetsAt }
  const anyReached = budgets.some((entry) => entry.reached)
  const reachedModels = budgets.find((entry) => entry.reached && entry.budget.coverage === "models")
  const resetsAt = Math.min(...info.budgets.map((budget) => budget.resetsAt))
  const go = info.go
  return {
    workspace: info.workspace.name,
    callout,
    go: go && (["rolling", "weekly", "monthly"] as const).map((window) => ({ window, ...go[window] })),
    budgets: budgets.map((entry, index) => ({
      id: entry.budget.id,
      label: label(entry.budget),
      limit: entry.budget.limit,
      perModel: entry.budget.per === "model",
      sharing: entry.budget.scope === "each" ? "you" : entry.budget.shared ? "everyone" : "group",
      notes: [
        ...(index === 0 && !callout && !anyReached && budgets.length > 1 ? [{ kind: "runs-out-first" as const }] : []),
        ...(entry.reached && entry.budget.coverage === "all" ? [{ kind: "includes-web-search" as const }] : []),
        // A budget per model names the model it paused instead.
        ...(entry.reached && entry.budget.coverage === "models" && entry.budget.per === "set"
          ? [{ kind: "paused" as const }]
          : []),
        ...(!entry.reached && blocking ? [{ kind: "paused-by" as const, shared: blocking.budget.shared }] : []),
        ...(entry.current ? [{ kind: "current-model" as const, name: entry.current.name }] : []),
      ],
      reached: entry.reached,
      spent: entry.spent,
      left: entry.left,
      fill: entry.budget.limit > 0 ? Math.min(1, entry.spent / entry.budget.limit) : 1,
    })),
    dimmed: callout !== undefined,
    action: callout || !reachedModels ? undefined : action(reachedModels.budget),
    footer:
      info.budgets.length === 0
        ? { kind: "credits-only" }
        : { kind: context.credits ? "budgets-reset" : "resets", resetsAt },
  }
}

/** What the member's budgets leave for one model: the least any budget covering it has left. */
export type ModelUsage = { readonly left: number; readonly reached: boolean; readonly resetsAt: number }

/**
 * What the Console budgets leave for a model, when any covers it. A budget on all spend covers every model the
 * workspace serves; OpenCode Go bills its own allowance instead.
 */
export function modelUsage(
  info: UsageLimitsInfo,
  model: { readonly id: string; readonly provider: { readonly id: string; readonly integrationID?: string } },
): ModelUsage | undefined {
  const served = model.provider.integrationID === "opencode" && model.provider.id !== "opencode-go"
  const covering = info.budgets.flatMap((budget) => {
    if (budget.coverage === "all") return served ? [{ budget, spent: budget.spent }] : []
    const entry = budget.models.find((item) => item.providerID === model.provider.id && item.modelID === model.id)
    if (!entry) return []
    return [{ budget, spent: budget.per === "model" ? (entry.spent ?? 0) : budget.spent }]
  })
  if (covering.length === 0) return undefined
  return {
    left: Math.min(...covering.map((entry) => Math.max(0, entry.budget.limit - entry.spent))),
    reached: covering.some((entry) => entry.spent >= entry.budget.limit),
    resetsAt: Math.min(...covering.map((entry) => entry.budget.resetsAt)),
  }
}

/** The spend a budget's cap compares against: a per-model budget's counter for the current model, when it covers it. */
function spend(budget: UsageLimitsBudget, model: CurrentModel | undefined) {
  const current =
    budget.per === "model" && model
      ? budget.models.find((entry) => entry.providerID === model.providerID && entry.modelID === model.modelID)
      : undefined
  const spent = current?.spent ?? budget.spent
  return { current: current && model, spent, reached: spent >= budget.limit, left: Math.max(0, budget.limit - spent) }
}

function label(budget: UsageLimitsBudget): BudgetLabel {
  const each = budget.per === "model"
  if (budget.coverage === "all") return { kind: "all" }
  if (budget.vendors.length > 0)
    return {
      kind: "vendors",
      vendors: budget.vendors,
      each,
      ...(budget.inputPriceAtLeast === undefined ? {} : { price: budget.inputPriceAtLeast }),
    }
  if (budget.inputPriceAtLeast !== undefined) return { kind: "price", price: budget.inputPriceAtLeast, each }
  if (budget.picked) return { kind: "models", names: budget.models.map((model) => model.name), each }
  return { kind: "each" }
}

// A per-model budget counts as reached by the model in use, so the model in use never has room to suggest.
function action(budget: UsageLimitsBudget): LimitAction {
  if (budget.per !== "model") return { kind: "other-models", vendors: budget.vendors }
  const room = budget.models
    .map((entry) => ({ name: entry.name, left: Math.max(0, budget.limit - (entry.spent ?? 0)) }))
    .filter((entry) => entry.left > 0)
    .toSorted((a, b) => b.left - a.left)[0]
  return {
    kind: "other-models-each",
    vendors: budget.vendors,
    limit: budget.limit,
    ...(room ? { suggestion: room } : {}),
  }
}
