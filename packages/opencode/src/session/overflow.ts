import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"

const COMPACTION_BUFFER = 20_000

export type ModelLimits = {
  /** Context window shared by input and output. `0` means the provider reported nothing usable. */
  context: number
  /** Explicit input cap when the provider separates it from the window. */
  input?: number
  /** Theoretical maximum output capability, not the amount reserved per request. */
  output: number
}

export type CompactionBudget = {
  capacity: number
  reserved: number
  /** Output requested per completion, already capped by `outputTokenMax`. */
  requestedOutput: number
  budget: number
}

const positive = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined
  return Math.floor(value)
}

/**
 * Validated limits. Malformed metadata degrades to "unknown" rather than to a
 * small default, so a 1M model is never mistaken for a 16k one.
 */
export function normalizeLimits(raw: { context?: unknown; input?: unknown; output?: unknown }): ModelLimits {
  return {
    context: positive(raw.context) ?? 0,
    input: positive(raw.input),
    output: positive(raw.output) ?? 0,
  }
}

/**
 * Tokens reserved for the next completion. A provider's theoretical output
 * capability is not an amount we must hold free on every request, so the
 * reservation is bounded by the buffer instead of by that capability.
 */
export function getCompactionBudget(input: {
  contextLimit: number
  inputLimit?: number
  maxOutputTokens: number
  bufferTokens?: number
  configuredReserved?: number
}): CompactionBudget {
  const context = positive(input.contextLimit) ?? 0
  const limit = positive(input.inputLimit)
  const requestedOutput = positive(input.maxOutputTokens) ?? ProviderTransform.OUTPUT_TOKEN_MAX
  const buffer = positive(input.bufferTokens) ?? COMPACTION_BUFFER
  const configured = input.configuredReserved
  const reserved =
    typeof configured === "number" && Number.isFinite(configured) && configured >= 0
      ? Math.floor(configured)
      : Math.min(buffer, requestedOutput)
  // An input cap above the window is unusable metadata, so the window wins.
  const capacity = limit === undefined ? context : Math.min(context || limit, limit)
  return {
    capacity,
    reserved,
    requestedOutput,
    budget: capacity > 0 ? Math.max(0, capacity - reserved) : 0,
  }
}

export function shouldCompact(input: { usedTokens: number; budget: number }): boolean {
  const budget = positive(input.budget) ?? 0
  if (budget === 0) return false
  return (positive(input.usedTokens) ?? 0) >= budget
}

function usedTokens(tokens: SessionV1.Assistant["tokens"]) {
  const sum = [tokens.input, tokens.output, tokens.reasoning, tokens.cache?.read, tokens.cache?.write].reduce(
    (total, value) => total + (positive(value) ?? 0),
    0,
  )
  // Providers report `total` inconsistently around reasoning and cache, so take
  // whichever is larger rather than trusting it over the itemized sum.
  return Math.max(sum, positive(tokens.total) ?? 0)
}

function requestedOutput(limits: ModelLimits, outputTokenMax?: number) {
  const max = positive(outputTokenMax) ?? ProviderTransform.OUTPUT_TOKEN_MAX
  return positive(limits.output) === undefined ? max : Math.min(limits.output, max)
}

export function usable(input: { cfg: ConfigV1.Info; model: Provider.Model; outputTokenMax?: number }) {
  const limits = normalizeLimits(input.model.limit)
  return getCompactionBudget({
    contextLimit: limits.context,
    inputLimit: limits.input,
    maxOutputTokens: requestedOutput(limits, input.outputTokenMax),
    configuredReserved: input.cfg.compaction?.reserved,
  }).budget
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
  const budget = usable(input)
  return shouldCompact({ usedTokens: usedTokens(input.tokens), budget })
}

export function compactionDebug(input: {
  model: Provider.Model
  tokens: SessionV1.Assistant["tokens"]
  cfg: ConfigV1.Info
  outputTokenMax?: number
  compact: boolean
}) {
  const limits = normalizeLimits(input.model.limit)
  const budget = getCompactionBudget({
    contextLimit: limits.context,
    inputLimit: limits.input,
    maxOutputTokens: requestedOutput(limits, input.outputTokenMax),
    configuredReserved: input.cfg.compaction?.reserved,
  })
  return (
    `compaction model=${input.model.providerID}/${input.model.id} context=${limits.context} ` +
    `input=${limits.input ?? "none"} outputMax=${limits.output} reserved=${budget.reserved} ` +
    `buffer=${COMPACTION_BUFFER} used=${usedTokens(input.tokens)} threshold=${budget.budget} ` +
    `compact=${input.compact}`
  )
}
