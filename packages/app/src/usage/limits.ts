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
  const covering = info.budgets.flatMap((budget) => {
    if (budget.coverage === "all") return servedByConsole(model) ? [{ budget, spent: budget.spent }] : []
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

/** OpenCode Console serves the model, so the workspace's limits can apply; OpenCode Go bills its own allowance. */
export function servedByConsole(model: {
  readonly provider: { readonly id: string; readonly integrationID?: string }
}) {
  return model.provider.integrationID === "opencode" && model.provider.id !== "opencode-go"
}

/** A model as the composer reads its limits: its price per 1M input tokens and its context window. */
export type LimitedModel = {
  readonly id: string
  readonly provider: { readonly id: string; readonly integrationID?: string }
  readonly cost?: { readonly input: number }
  readonly limit: { readonly context: number }
}

/**
 * `low` means what's left won't cover three requests that fill the model's context, `out` that it won't cover one. Both
 * depend on the model: a few dollars is plenty for a cheap model and almost nothing for an expensive one.
 */
export type UsageLevel = "plenty" | "low" | "out" | "reached"

export function usageLevel(usage: ModelUsage, model: LimitedModel): UsageLevel {
  if (usage.reached || usage.left <= 0) return "reached"
  const request = (model.limit.context / 1_000_000) * (model.cost?.input ?? 0)
  if (usage.left < request) return "out"
  if (usage.left < request * 3) return "low"
  return "plenty"
}

/** What the composer's model trigger says about the model's limits: nothing while there's plenty left. */
export type ModelBadge = { readonly kind: "free" } | { readonly kind: "left"; readonly left: number }

/** A reached budget shows no badge. */
export function modelBadge(
  model: LimitedModel | undefined,
  context: { readonly free: boolean; readonly info: UsageLimitsInfo | null | undefined },
): ModelBadge | undefined {
  if (!model) return undefined
  if (context.free) return { kind: "free" }
  const usage = context.info ? modelUsage(context.info, model) : undefined
  if (!usage) return undefined
  const level = usageLevel(usage, model)
  return level === "low" || level === "out" ? { kind: "left", left: usage.left } : undefined
}

/** Why the selected model can't run, which the composer gives way to. */
export type UsageBlock =
  | { readonly kind: "go"; readonly window?: GoRow["window"]; readonly resetsAt?: number }
  | { readonly kind: "model" | "workspace"; readonly resetsAt?: number }
  | { readonly kind: "credits" }

/** A failed step as it is kept on the session's last assistant message. */
export type UsageRefusal = {
  readonly model: { readonly providerID: string; readonly id: string }
  readonly time: { readonly created: number; readonly completed?: number }
  readonly error?: {
    readonly type: string
    readonly status?: number
    readonly retryAfterMs?: number
    readonly response?: { readonly body: string }
  }
}

// A refusal that doesn't say when it resets holds this long, so the composer comes back to try again.
const UNKNOWN_RESET_HOLD_MS = 3_600_000

/**
 * Whether the selected model is out, from the session's last refusal for this model or from the usage limits. A refusal
 * holds until it resets or the model changes; usage limits catch a model that is out before anything is sent.
 */
export function usageBlock(input: {
  readonly model: LimitedModel | undefined
  readonly free: boolean
  readonly info: UsageLimitsInfo | null | undefined
  readonly last?: UsageRefusal
  readonly now: number
}): UsageBlock | undefined {
  const model = input.model
  if (!model) return undefined
  return (
    refusalBlock(model, input.last, input.now) ?? (input.free ? undefined : limitsBlock(model, input.info, input.now))
  )
}

function refusalBlock(model: LimitedModel, last: UsageRefusal | undefined, now: number): UsageBlock | undefined {
  const error = last?.error
  if (!last || !error || last.model.providerID !== model.provider.id || last.model.id !== model.id) return undefined
  const body = error.response?.body ?? ""
  const refused = last.time.completed ?? last.time.created
  const resetsAt = refusalReset(body) ?? retryReset(error.retryAfterMs, refused)
  if ((resetsAt ?? refused + UNKNOWN_RESET_HOLD_MS) <= now) return undefined
  if (error.type === "provider.go-limit") return { kind: "go", window: goWindow(body), resetsAt }
  if (error.type === "provider.model-budget-limit") return { kind: "model", resetsAt }
  if (error.type === "provider.budget-limit") return { kind: "workspace", resetsAt }
  // OpenCode Console refuses with 402 only when the workspace can't pay.
  if (error.status === 402 && servedByConsole(model)) return { kind: "credits" }
  return undefined
}

function limitsBlock(
  model: LimitedModel,
  info: UsageLimitsInfo | null | undefined,
  now: number,
): UsageBlock | undefined {
  if (!info) return undefined
  if (model.provider.id === "opencode-go") {
    const go = info.go
    const window =
      go && (["rolling", "weekly", "monthly"] as const).find((item) => go[item].limited && go[item].resetsAt > now)
    return go && window ? { kind: "go", window, resetsAt: go[window].resetsAt } : undefined
  }
  const usage = modelUsage(info, model)
  if (!usage?.reached || usage.resetsAt <= now) return undefined
  const blocking = servedByConsole(model)
    ? info.budgets.find((budget) => budget.coverage === "all" && budget.spent >= budget.limit)
    : undefined
  return blocking ? { kind: "workspace", resetsAt: blocking.resetsAt } : { kind: "model", resetsAt: usage.resetsAt }
}

/** OpenCode Console names the reset `resetsAt` in every protocol's error envelope. */
function refusalReset(body: string) {
  const at = Date.parse(/"resetsAt"\s*:\s*"([^"]+)"/.exec(body)?.[1] ?? "")
  return Number.isNaN(at) ? undefined : at
}

/** A `retry-after` counted from the refusal; nothing past 45 days, as a bad header. */
function retryReset(delay: number | undefined, base: number) {
  if (delay === undefined || !Number.isFinite(delay) || delay < 0 || delay > 45 * 86_400_000) return undefined
  return base + delay
}

/** Which Go limit refused a request, as OpenCode Console names it in the metadata ("5 hour", "weekly", "monthly"). */
function goWindow(body: string): GoRow["window"] | undefined {
  const name = /"limitName"\s*:\s*"([^"]+)"/.exec(body)?.[1]
  if (!name) return undefined
  if (/week/i.test(name)) return "weekly"
  if (/month/i.test(name)) return "monthly"
  return "rolling"
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
