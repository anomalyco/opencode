import type { UsageLimitsBudget, UsageLimitsInfo } from "@opencode/client"

/** A model as the usage limits read it: its OpenCode IDs, its price and context window, and its provider. */
export type LimitedModel = {
  readonly id: string
  readonly providerID: string
  readonly cost: ReadonlyArray<{ readonly input: number }>
  readonly limit: { readonly context: number }
}

export type LimitedProvider = { readonly id: string; readonly integrationID?: string }

/** One limit on a model: what has been spent against it and what is left. */
export type ModelLimit = {
  readonly budget: UsageLimitsBudget
  readonly spent: number
  readonly left: number
}

/** What a model has left: the limit closest to running out sets it, since any limit that runs out stops the model. */
export type ModelUsage = {
  readonly left: number
  readonly reached: boolean
  readonly resetsAt: number
  /** Every limit on the model, the one that sets `left` first. */
  readonly limits: readonly ModelLimit[]
}

/**
 * `low` means what's left won't cover three requests that fill the model's context, `out` that it won't cover one. Both
 * depend on the model: a few dollars is plenty for a cheap model and almost nothing for an expensive one.
 */
export type UsageLevel = "plenty" | "low" | "out" | "reached"

/** OpenCode Console serves the model, so the workspace's limits can apply; OpenCode Go bills its own allowance. */
export function servedByConsole(provider: LimitedProvider | undefined) {
  return provider?.integrationID === "opencode" && provider.id !== "opencode-go"
}

/** The limits on a paid model, or nothing when none applies; free models stay usable whatever is spent. */
export function modelUsage(
  info: UsageLimitsInfo,
  model: LimitedModel,
  provider: LimitedProvider | undefined,
): ModelUsage | undefined {
  if (model.cost.length > 0 && model.cost.every((cost) => cost.input === 0)) return undefined
  const limits = info.budgets
    .flatMap((budget): ModelLimit[] => {
      if (budget.coverage === "all") return servedByConsole(provider) ? [limit(budget, budget.spent)] : []
      const entry = budget.models.find((item) => item.providerID === model.providerID && item.modelID === model.id)
      if (!entry) return []
      return [limit(budget, budget.per === "model" ? (entry.spent ?? 0) : budget.spent)]
    })
    .toSorted((a, b) => a.left - b.left)
  const binding = limits[0]
  if (!binding) return undefined
  return {
    left: binding.left,
    reached: limits.some((item) => item.spent >= item.budget.limit),
    resetsAt: Math.min(...limits.map((item) => item.budget.resetsAt)),
    limits,
  }
}

export function usageLevel(usage: ModelUsage, model: LimitedModel): UsageLevel {
  if (usage.reached || usage.left <= 0) return "reached"
  const request = (model.limit.context / 1_000_000) * (model.cost[0]?.input ?? 0)
  if (usage.left < request) return "out"
  if (usage.left < request * 3) return "low"
  return "plenty"
}

/** Dollars as limits read: whole amounts without cents, and a sliver as "<$0.01" rather than "$0.00". */
export function formatDollars(value: number) {
  if (value > 0 && value < 0.01) return "<$0.01"
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value)
}

/** When limits reset: the day, with the time unless it is midnight here, or just the time when that is today. */
export function formatReset(at: number) {
  const date = new Date(at)
  // ICU puts a narrow no-break space before AM/PM, which terminals may draw at the wrong width.
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).replace(/\u202f/g, " ")
  if (date.toDateString() === new Date().toDateString()) return `${time} today`
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  return date.getHours() === 0 && date.getMinutes() === 0 ? day : `${day}, ${time}`
}

/** When a refused request's limit resets: OpenCode Console names it `resetsAt` in every protocol's error envelope. */
export function refusalReset(error: { readonly response?: { readonly body: string } } | undefined) {
  const at = Date.parse(/"resetsAt"\s*:\s*"([^"]+)"/.exec(error?.response?.body ?? "")?.[1] ?? "")
  return Number.isNaN(at) ? undefined : at
}

/** When a refused request may retry, from its `retry-after` counted from `base`; nothing past a week, as a bad header. */
export function retryReset(error: { readonly retryAfterMs?: number } | undefined, base: number) {
  const delay = error?.retryAfterMs
  if (delay === undefined || !Number.isFinite(delay) || delay < 0 || delay > 7 * 86_400_000) return undefined
  const at = base + delay
  return Number.isNaN(new Date(at).getTime()) ? undefined : at
}

/** Which Go limit refused a request (5 hour, weekly or monthly), as OpenCode Console names it in the metadata. */
export function goLimitName(error: { readonly response?: { readonly body: string } } | undefined) {
  return /"limitName"\s*:\s*"([^"]+)"/.exec(error?.response?.body ?? "")?.[1]
}

/** The OpenCode Console Go page for the workspace a Go usage limit names, where it can turn on Extra Usage. */
export function goLimitLink(error: { readonly response?: { readonly body: string } } | undefined) {
  const workspace = /"workspace"\s*:\s*"(wrk_\w+)"/.exec(error?.response?.body ?? "")?.[1]
  return workspace ? `https://opencode.ai/console/${workspace}/go` : "https://opencode.ai/console"
}

/**
 * Who spends from a limit and, when it pools spend across models, which ones. A limit on each model separately names
 * only who spends from it.
 */
export function limitScope(budget: UsageLimitsBudget, workspace: string | undefined) {
  const who =
    budget.scope === "each"
      ? "Only you"
      : budget.shared
        ? `Everyone in ${workspace ?? "the workspace"}`
        : "You and others"
  if (budget.per === "model") return who
  return `${who} · ${limitModels(budget)}`
}

function limitModels(budget: UsageLimitsBudget) {
  if (budget.coverage === "all") return "All models"
  const vendors = budget.vendors.length > 0 ? list(budget.vendors) : undefined
  const price = budget.inputPriceAtLeast === undefined ? undefined : `${formatDollars(budget.inputPriceAtLeast)} per 1M`
  if (vendors && price) return `${vendors} models over ${price}`
  if (vendors) return `All ${vendors} models`
  if (price) return `Models over ${price}`
  const names = budget.models.map((model) => model.name)
  if (names.length > 3) return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`
  return names.join(", ")
}

function list(items: readonly string[]) {
  return new Intl.ListFormat("en-US", { style: "long", type: "conjunction" }).format(items)
}

function limit(budget: UsageLimitsBudget, spent: number): ModelLimit {
  return { budget, spent, left: Math.max(0, budget.limit - spent) }
}
