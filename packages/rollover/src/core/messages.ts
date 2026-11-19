/**
 * User-visible strings in English, single source (spec Part A §0.1).
 * Model-facing text (render, prompts) lives in render.ts / prompts.ts in English.
 * The full /rollover status builder lands with the command layer (plan Task 18)
 * so this module never depends on modules its task hasn't built yet.
 */

export const ROLLOVER_CTX_PREFIX = "<rollover_context epoch='"
export const ROLLOVER_CTX_SUFFIX = "</rollover_context>"

const formatTokens = (n: number) => (n >= 1000 ? `${Math.round((n / 1000) * 10) / 10}k`.replace(".0k", "k") : String(n))

const formatLimit = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M`.replace(".0M", "M") : formatTokens(n))

const formatClock = (at: number) => {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`
}

/** `Rollover applied: 187k → 6k tokens (ledger 3.9k + tail 2k).` */
export function rolloverToast(input: {
  tokensBefore: number
  tokensAfter: number
  renderTokens: number
  tailTokens: number
}): string {
  const k = (n: number) => `${Math.round((n / 100) / 10 * 10) / 10}k`
  return `Rollover applied: ${k(input.tokensBefore)} → ${k(input.tokensAfter)} tokens (ledger ${k(input.renderTokens)} + tail ${k(input.tailTokens)}).`
}

export interface StatusTextInput {
  mode: "off" | "metrics_only" | "auto"
  thresholdValue: number
  thresholdSource: "session" | "config" | "computed" | "fallback"
  modelLimit: number | null
  /** `usage` = provider-reported; `estimate` = chars/4 fallback. */
  contextSource: "usage" | "estimate"
  contextTokens: number
  tailN: number
  summaryModel: string | null
  recordCount: number
  epoch: number
  /** null = no active render (rollover is not running) → the card shows "—". */
  renderTokens: number | null
  renderBudgetTokens: number
  lastRollover: { before: number; after: number; at: number } | null
}

/** `/rollover` (bare) reply notes (2026-11-17: bare command = activate). */
export const MSG_ACTIVATED = "Rollover activated (auto mode)."
export const MSG_ALREADY_ACTIVE = "Rollover is already active."

/** `/rollover status` (spec §9.3 fixed English format). */
export function statusText(input: StatusTextInput): string {
  const percent = input.thresholdValue > 0 ? Math.round((input.contextTokens / input.thresholdValue) * 100) : 0
  const limit = input.modelLimit === null ? "unknown" : formatLimit(input.modelLimit)
  const summary = input.summaryModel ?? "session model"
  const warning = input.summaryModel === null ? " (warning: using the session model)" : ""
  const last = input.lastRollover
    ? `${formatTokens(input.lastRollover.before)} → ${formatTokens(input.lastRollover.after)} (${formatClock(input.lastRollover.at)})`
    : "—"
  // The active render exists only while rollover runs (auto): before
  // activation nothing is rendered, so the card shows "—" instead of a
  // packed preview (2026-11-17).
  const render =
    input.renderTokens === null
      ? "—"
      : `≈ ${formatTokens(input.renderTokens)} / ${formatTokens(input.renderBudgetTokens)}`
  return [
    MODE_LABEL[input.mode],
    `Threshold: ${formatTokens(input.thresholdValue)} (model limit: ${limit}, source: ${input.thresholdSource})`,
    `Current context: ${formatTokens(input.contextTokens)} (${percent}% of threshold, ${input.contextSource})`,
    `Tail: last ${input.tailN} prompts`,
    `Summary model: ${summary}${warning}`,
    `Ledger: ${input.recordCount} records, epoch ${input.epoch}, active render ${render}`,
    `Last rollover: ${last}`,
  ].join("\n")
}

export interface ShowTextInput {
  renderText: string
  renderTokens: number
  renderBudgetTokens: number
  epoch: number
  counts: Record<string, number>
  truncated: boolean
  raw?: boolean
}

const SHOW_COUNT_LABELS: Array<[string, string]> = [
  ["user_correction", "Rules"],
  ["decision", "Decisions"],
  ["open_item", "Open items"],
  ["verification", "Verifications"],
  ["objective", "Objectives"],
]

const SHOW_PREAMBLE_PREFIX = "Earlier conversation history was replaced"

/** `/rollover show`: clean report of the pending render; `raw` keeps the exact model-facing payload. */
export function showText(input: ShowTextInput): string {
  if (input.raw === true) return rawShowText(input)
  const header = `Rollover render preview — ${formatTokens(input.renderTokens)} / ${formatTokens(input.renderBudgetTokens)} tokens (epoch ${input.epoch})${input.truncated ? " · truncated" : ""}`
  const counts = SHOW_COUNT_LABELS.flatMap(([type, label]) =>
    (input.counts[type] ?? 0) > 0 ? [`${label}: ${input.counts[type]}`] : [],
  )
  const body = showBodyLines(input.renderText)
  const lines = [header, counts.length > 0 ? counts.join(" · ") : "No records yet."]
  if (body.length > 0) lines.push("─".repeat(46), ...body)
  return lines.join("\n")
}

function rawShowText(input: ShowTextInput): string {
  const counts = ["objective", "decision", "user_correction", "open_item", "verification"]
    .map((type) => `${type} ${input.counts[type] ?? 0}`)
    .join(", ")
  return [
    `Render preview (≈ ${formatTokens(input.renderTokens)} tokens):`,
    input.renderText,
    "",
    `Records: ${counts}`,
  ].join("\n")
}

function showBodyLines(renderText: string): string[] {
  const out: string[] = []
  for (const line of renderText.split("\n")) {
    if (line === "" || line.startsWith(ROLLOVER_CTX_PREFIX) || line === ROLLOVER_CTX_SUFFIX || line.startsWith(SHOW_PREAMBLE_PREFIX)) continue
    if (line.startsWith("## ")) {
      if (out.length > 0) out.push("")
      out.push(line.slice(3))
      continue
    }
    out.push(`  ${line}`)
  }
  return out
}

export const ERR_THRESHOLD_MIN = (min: number) => `Threshold must be at least ${formatTokens(min)}.`
export const ERR_THRESHOLD_MAX = (limit: string) => `Threshold cannot exceed the model limit (${limit}).`
export const ERR_TAIL_RANGE = (max: number) => `n must be between 0 and ${max}.`
export const ERR_CTL = (detail: string) => `Rollover error: ${detail}`

export const MODE_LABEL = {
  off: "Rollover: off",
  metrics_only: "Rollover: metrics only",
  auto: "Rollover: on (auto)",
} as const
