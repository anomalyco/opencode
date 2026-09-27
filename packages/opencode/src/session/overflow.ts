import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

export const COMPACTION_BUFFER = 20_000

/**
 * Authoritative normalized model limits for compaction budgeting.
 *
 * All compaction decisions must flow through `normalizeLimits` ->
 * `getCompactionBudget` -> `shouldCompact` instead of interpreting
 * `provider metadata` ad-hoc. This keeps built-in, provider-override,
 * user-override and fallback handling in one validated place.
 */
export type ModelLimits = {
  /** Total context capacity (input + output share this window). 0 = unknown/disabled. */
  context: number
  /** Optional explicit input cap. Undefined when the provider does not expose one. */
  input?: number
  /** Provider theoretical maximum output capability. 0 = unknown. */
  output: number
}

const finiteNonNegative = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  if (value < 0) return undefined
  return Math.floor(value)
}

/**
 * Normalize raw provider metadata into validated limits.
 *
 * Safety rules (generic, no model-specific hacks):
 * - Non-numeric, NaN, Infinite, negative, null/undefined context -> 0 (unknown -> never compact).
 * - Non-numeric/negative input -> undefined (fall back to context).
 * - Non-numeric/negative output -> 0 (unknown output capability).
 * - `output > context` is kept as-is on the type but budgeting caps the
 *   *reservation* so a huge theoretical output never zeroes the usable budget.
 * Never silently maps a known large model to a small fallback.
 */
export function normalizeLimits(raw: { context?: unknown; input?: unknown; output?: unknown }): ModelLimits {
  const context = finiteNonNegative(raw.context) ?? 0
  const parsedInput = finiteNonNegative(raw.input)
  const input = parsedInput !== undefined && parsedInput > 0 ? parsedInput : undefined
  const output = finiteNonNegative(raw.output) ?? 0
  return { context, input, output }
}

/**
 * Requested output for *this* request (not the provider theoretical maximum).
 * Bounded by `outputTokenMax` (runtime flag) and the shared OUTPUT_TOKEN_MAX
 * default so a 512k theoretical capability does not force a 512k reservation.
 */
export function getRequestedOutputTokens(input: {
  outputCapability: number
  outputTokenMax?: number
}): number {
  const fallback = ProviderTransform.OUTPUT_TOKEN_MAX
  const rawMax = input.outputTokenMax
  const effectiveMax =
    typeof rawMax === "number" && Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : fallback
  const capability =
    typeof input.outputCapability === "number" &&
    Number.isFinite(input.outputCapability) &&
    input.outputCapability > 0
      ? Math.floor(input.outputCapability)
      : 0
  if (capability <= 0) return effectiveMax
  return Math.min(capability, effectiveMax)
}

/**
 * Output capacity reserved for the next generation.
 * User-configured `compaction.reserved` wins; otherwise bound by
 * `min(buffer, requested)` so large-output models (e.g. 1M context / 512k
 * theoretical output) only reserve a sane response window.
 */
export function getReservedOutputTokens(input: {
  requestedOutputTokens: number
  bufferTokens?: number
  configuredReserved?: number
}): number {
  if (
    typeof input.configuredReserved === "number" &&
    Number.isFinite(input.configuredReserved) &&
    input.configuredReserved >= 0
  ) {
    return Math.floor(input.configuredReserved)
  }
  const buffer =
    typeof input.bufferTokens === "number" && Number.isFinite(input.bufferTokens) && input.bufferTokens >= 0
      ? Math.floor(input.bufferTokens)
      : COMPACTION_BUFFER
  const requested =
    typeof input.requestedOutputTokens === "number" &&
    Number.isFinite(input.requestedOutputTokens) &&
    input.requestedOutputTokens > 0
      ? Math.floor(input.requestedOutputTokens)
      : ProviderTransform.OUTPUT_TOKEN_MAX
  return Math.min(buffer, requested)
}

export type CompactionBudget = {
  /** Effective input capacity: min(context, input?) when known, else 0. */
  capacity: number
  /** Bounded reservation for the next response. */
  reserved: number
  /** Requested output for this request (capped, not theoretical max). */
  requestedOutput: number
  /** Usable conversation budget: max(0, capacity - reserved). */
  budget: number
  /** Provider theoretical maximum output capability (for diagnostics). */
  outputCapability: number
}

/**
 * Pure, unit-testable budget calculation.
 * `capacity` uses `min(context, input)` when both are known so an input cap
 * larger than context cannot inflate the budget beyond the real window.
 */
export function getCompactionBudget(input: {
  contextLimit: number
  inputLimit?: number
  maxOutputTokens: number
  bufferTokens?: number
  configuredReserved?: number
}): CompactionBudget {
  const context =
    typeof input.contextLimit === "number" && Number.isFinite(input.contextLimit) && input.contextLimit > 0
      ? Math.floor(input.contextLimit)
      : 0
  const parsedInput =
    typeof input.inputLimit === "number" && Number.isFinite(input.inputLimit) && input.inputLimit > 0
      ? Math.floor(input.inputLimit)
      : undefined
  const capacity = context <= 0 ? (parsedInput ?? 0) : parsedInput !== undefined ? Math.min(context, parsedInput) : context
  // `maxOutputTokens` is the already-capped requested value when called from
  // `usable` (see getRequestedOutputTokens). Keep the name for compatibility.
  const requestedOutput =
    typeof input.maxOutputTokens === "number" &&
    Number.isFinite(input.maxOutputTokens) &&
    input.maxOutputTokens > 0
      ? Math.floor(input.maxOutputTokens)
      : ProviderTransform.OUTPUT_TOKEN_MAX
  const reserved = getReservedOutputTokens({
    requestedOutputTokens: requestedOutput,
    bufferTokens: input.bufferTokens,
    configuredReserved: input.configuredReserved,
  })
  // Unknown capacity (0) means "do not compact" — never synthesize a small fallback.
  if (capacity <= 0) {
    return {
      capacity: 0,
      reserved,
      requestedOutput,
      budget: 0,
      outputCapability: requestedOutput,
    }
  }
  return {
    capacity,
    reserved,
    requestedOutput,
    budget: Math.max(0, capacity - reserved),
    outputCapability: requestedOutput,
  }
}

/** Pure threshold decision, unit-testable independently from session code. */
export function shouldCompact(input: { usedTokens: number; budget: number }): boolean {
  const used =
    typeof input.usedTokens === "number" && Number.isFinite(input.usedTokens) ? Math.floor(input.usedTokens) : 0
  const budget =
    typeof input.budget === "number" && Number.isFinite(input.budget) ? Math.floor(input.budget) : 0
  // Unknown/disabled budget (0) never compacts — prevents empty-session loops
  // and avoids silently treating a 1M model with missing metadata as tiny.
  // Tiny-but-known models (capacity <= reserved) also yield 0 here and fall
  // back to provider-overflow recovery rather than an immediate loop.
  if (budget <= 0) return false
  return used >= budget
}

/** Token accounting including reasoning + cache (AI SDK v6 includes cache in input). */
export function getUsedTokens(tokens: SessionV1.Assistant["tokens"]): number {
  const safe = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0
    return Math.max(0, Math.floor(value))
  }
  const input = safe(tokens.input)
  const output = safe(tokens.output)
  const reasoning = safe((tokens as { reasoning?: unknown }).reasoning)
  const cacheRead = safe(tokens.cache?.read)
  const cacheWrite = safe(tokens.cache?.write)
  const sum = input + output + reasoning + cacheRead + cacheWrite
  const total = safe((tokens as { total?: unknown }).total)
  if (total > 0) return Math.max(total, sum)
  return sum
}

export type CompactionCheck = {
  modelID: string
  providerID: string
  contextLimit: number
  inputLimit?: number
  outputCapability: number
  requestedOutput: number
  reserved: number
  buffer: number
  capacity: number
  used: number
  threshold: number
  compact: boolean
  reason: string
}

/** Structured diagnostics for debug logging (no spam on normal runs). */
export function describeCompactionCheck(input: {
  model: Provider.Model
  usedTokens: number
  budget: CompactionBudget
  compact: boolean
  reason: string
}): CompactionCheck {
  const limits = normalizeLimits(input.model.limit)
  return {
    modelID: String(input.model.id ?? "unknown"),
    providerID: String(input.model.providerID ?? "unknown"),
    contextLimit: limits.context,
    inputLimit: limits.input,
    outputCapability: limits.output,
    requestedOutput: input.budget.requestedOutput,
    reserved: input.budget.reserved,
    buffer: COMPACTION_BUFFER,
    capacity: input.budget.capacity,
    used: input.usedTokens,
    threshold: input.budget.budget,
    compact: input.compact,
    reason: input.reason,
  }
}

export function formatCompactionCheck(check: CompactionCheck): string {
  return (
    `Compaction check: model=${check.providerID}/${check.modelID} ` +
    `context=${check.contextLimit} input=${check.inputLimit ?? "none"} ` +
    `outputMax=${check.outputCapability} outputReserved=${check.reserved} ` +
    `buffer=${check.buffer} used=${check.used} threshold=${check.threshold} ` +
    `compact=${check.compact} reason=${check.reason}`
  )
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const limits = normalizeLimits(input.model.limit)
  if (limits.context === 0 && limits.input === undefined) return 0
  const requested = getRequestedOutputTokens({
    outputCapability: limits.output,
    outputTokenMax: input.outputTokenMax,
  })
  const budget = getCompactionBudget({
    contextLimit: limits.context,
    inputLimit: limits.input,
    maxOutputTokens: requested,
    bufferTokens: COMPACTION_BUFFER,
    configuredReserved: input.cfg.compaction?.reserved,
  })
  return budget.budget
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
}) {
  if (input.cfg.compaction?.auto === false) return false
  const limits = normalizeLimits(input.model.limit)
  if (limits.context === 0 && limits.input === undefined) return false

  const used = getUsedTokens(input.tokens)
  const budget = usable(input)
  if (budget <= 0) return false
  return shouldCompact({ usedTokens: used, budget })
}
