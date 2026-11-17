/** Command parsing + validation (spec Part A §9.2). Pure functions. */

export type ParsedCommand =
  | { kind: "status" }
  | { kind: "activate" }
  | { kind: "show"; raw?: boolean }
  | { kind: "enable" }
  | { kind: "disable" }
  | { kind: "settings"; thresholdTokens?: number; tailN?: number; renderBudgetTokens?: number }
  | { kind: "error"; message: string }

export interface ValidateOpts {
  thresholdMinTokens: number
  modelLimit: number | null
  tailMaxN: number
}

export type ValidateResult =
  | { ok: true; settings: { thresholdTokens?: number; tailN?: number; renderBudgetTokens?: number } }
  | { ok: false; message: string }

const MULTIPLIERS: Record<string, number> = { k: 1000, m: 1000000 }

// Below this the render cannot even fit the shell text plus user corrections.
const RENDER_BUDGET_MIN_TOKENS = 1_000
const RENDER_BUDGET_ERROR = "Render budget must be at least 1k."

function parseNumberToken(tok: string): number | null {
  const m = tok.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*([km]?)$/)
  if (!m) return null
  const num = Number(m[1])
  if (!Number.isFinite(num)) return null
  return Math.round(num * (MULTIPLIERS[m[2]] ?? 1))
}

export function parseCommand(input: string): ParsedCommand {
  const tokens = input.trim().split(/\s+/).filter(Boolean)
  // Bare `/rollover` activates (2026-11-17): typing just the command means
  // "turn rollover on for this chat" (auto mode). `/rollover status` stays
  // the explicit status query. Whether the session is already active is
  // decided by the executor — it owns the current state.
  if (tokens.length === 0) return { kind: "activate" }
  if (tokens.length === 1 && tokens[0].toLowerCase() === "status") return { kind: "status" }
  if (tokens[0].toLowerCase() === "show") {
    if (tokens.length === 1) return { kind: "show" }
    if (tokens.length === 2 && tokens[1].toLowerCase() === "raw") return { kind: "show", raw: true }
    return { kind: "error", message: "Usage: /rollover show [raw]." }
  }
  // Per-session opt-in (2026-11-17): `on` enables the full pipeline for this
  // session only; `off` disables it. Both win over every config layer.
  if (tokens[0].toLowerCase() === "on" || tokens[0].toLowerCase() === "off") {
    if (tokens.length > 1) return { kind: "error", message: "Usage: /rollover on | /rollover off." }
    return { kind: tokens[0].toLowerCase() === "on" ? "enable" : "disable" }
  }

  let thresholdTokens: number | undefined
  let tailN: number | undefined
  let renderBudgetTokens: number | undefined
  let i = 0
  while (i < tokens.length) {
    const t = tokens[i]
    if (t === "-n") {
      const v = tokens[i + 1]
      if (v === undefined) return { kind: "error", message: "n must be between 0 and 20." }
      const n = Number(v)
      if (!Number.isInteger(n)) return { kind: "error", message: "n must be between 0 and 20." }
      if (n < 0 || n > 20) return { kind: "error", message: "n must be between 0 and 20." }
      tailN = n
      i += 2
      continue
    }
    if (t === "--render") {
      const v = tokens[i + 1]
      const n = v === undefined ? null : parseNumberToken(v)
      if (n === null || renderBudgetTokens !== undefined) return { kind: "error", message: RENDER_BUDGET_ERROR }
      renderBudgetTokens = n
      i += 2
      continue
    }
    const num = parseNumberToken(t)
    if (num === null) return { kind: "error", message: "Threshold must be at least 20k." }
    if (thresholdTokens !== undefined) return { kind: "error", message: "Threshold must be at least 20k." }
    thresholdTokens = num
    i += 1
  }

  if (tailN !== undefined && (!Number.isInteger(tailN) || tailN < 0)) {
    return { kind: "error", message: "n must be between 0 and 20." }
  }
  if (thresholdTokens === undefined && tailN === undefined && renderBudgetTokens === undefined) {
    return { kind: "error", message: "Threshold must be at least 20k." }
  }
  return { kind: "settings", thresholdTokens, tailN, renderBudgetTokens }
}

export function validateSettings(parsed: ParsedCommand, opts: ValidateOpts): ValidateResult {
  if (parsed.kind === "error") return { ok: false, message: parsed.message }
  if (parsed.kind !== "settings") return { ok: false, message: "Threshold must be at least 20k." }
  const settings: { thresholdTokens?: number; tailN?: number; renderBudgetTokens?: number } = {}
  if (parsed.thresholdTokens !== undefined) {
    if (parsed.thresholdTokens < opts.thresholdMinTokens) {
      return { ok: false, message: `Threshold must be at least ${formatTokens(opts.thresholdMinTokens)}.` }
    }
    if (opts.modelLimit !== null && parsed.thresholdTokens > opts.modelLimit) {
      return { ok: false, message: `Threshold cannot exceed the model limit (${formatTokens(opts.modelLimit)}).` }
    }
    settings.thresholdTokens = parsed.thresholdTokens
  }
  if (parsed.tailN !== undefined) {
    if (parsed.tailN < 0 || parsed.tailN > opts.tailMaxN) {
      return { ok: false, message: `n must be between 0 and ${opts.tailMaxN}.` }
    }
    settings.tailN = parsed.tailN
  }
  if (parsed.renderBudgetTokens !== undefined) {
    if (parsed.renderBudgetTokens < RENDER_BUDGET_MIN_TOKENS) {
      return { ok: false, message: RENDER_BUDGET_ERROR }
    }
    settings.renderBudgetTokens = parsed.renderBudgetTokens
  }
  return { ok: true, settings }
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${n / 1_000_000}M`.replace(".0M", "M")
  if (n >= 1000) return `${Math.round((n / 1000) * 10) / 10}k`.replace(".0k", "k")
  return String(n)
}
