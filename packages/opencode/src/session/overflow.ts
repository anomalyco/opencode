import type { Config } from "@/config/config"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import type { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "./message-v2"

const COMPACTION_BUFFER = 20_000
const RESERVED_MINIMUM = 2_048
const RESERVED_RATIO = 0.15

// An unset/zero context limit must not read as infinite: router and local
// providers frequently report 0, which previously disabled proactive
// compaction entirely and let every session run into provider overflow
// errors. Unless auto compaction is explicitly off, assume this conservative
// usable window, shrunk further by any session-level cap learned from
// provider overflow errors.
export const DEFAULT_USABLE_CONTEXT = 32_000

const learnedLimits = new Map<string, number>()
const warnedSessions = new Set<string>()

// W6-4: the most recent request's budget arithmetic, per session.
//
// Proactive compaction is incremental: it triggers once accumulated history
// crosses `usable`. That leaves one gap it cannot close — a single tool result
// large enough to take a request from comfortably under budget to over the
// window in one step never crosses the trigger on the way up, and the provider
// rejects the whole request. Observed on a 96 KB file read: 57,632 tokens
// against a 56,320 window, from a turn that was well inside budget the step
// before.
//
// Closing it needs the headroom figure at the moment a tool runs, but the
// arithmetic only exists where the fully composed request does — in request
// preparation, which has already happened by then. So preparation publishes
// what it computed and tools read the freshest snapshot.
export type Headroom = {
  usable: number
  estimated: number
  // Tokens a tool result may add before the next request exceeds the window.
  // Never negative: a turn already over budget reports zero, not a deficit.
  headroom: number
}

const headrooms = new Map<string, Headroom>()

export function recordHeadroom(sessionID: string, input: { usable: number; estimated: number }) {
  if (input.usable <= 0) return
  headrooms.set(sessionID, {
    usable: input.usable,
    estimated: input.estimated,
    headroom: Math.max(0, input.usable - input.estimated),
  })
}

export function headroom(sessionID: string): Headroom | undefined {
  return headrooms.get(sessionID)
}

// Records the estimated input size of a request the provider rejected for
// context overflow. Used as an upper bound on the real window for models that
// report no context limit; only the smallest observation is kept.
export function learnContextLimit(sessionID: string, tokens: number) {
  if (tokens <= 0) return
  const prior = learnedLimits.get(sessionID)
  if (prior === undefined || tokens < prior) learnedLimits.set(sessionID, tokens)
}

// True exactly once per session when the model reports no context limit while
// auto compaction stays enabled, so the caller can log the fallback loudly.
export function shouldWarnUnsetLimit(input: { cfg: ConfigV1.Info; model: Provider.Model; sessionID: string }) {
  if (input.model.limit.context) return false
  if (input.cfg.compaction?.auto === false) return false
  if (warnedSessions.has(input.sessionID)) return false
  warnedSessions.add(input.sessionID)
  return true
}

// Compaction reserve proportional to the window: a fixed 20k reserve is ~36%
// of a 56k local window but only 10% of 200k. `compaction.reserved` config
// keeps absolute priority; the min() keeps large-window behavior unchanged.
export function reserved(cfg: ConfigV1.Info, context: number) {
  return (
    cfg.compaction?.reserved ??
    Math.min(COMPACTION_BUFFER, Math.max(RESERVED_MINIMUM, Math.floor(context * RESERVED_RATIO)))
  )
}

export function usable(input: {
  cfg: ConfigV1.Info
  model: Provider.Model
  outputTokenMax?: number
  sessionID?: string
}) {
  const context = input.model.limit.context
  if (!context) {
    if (input.cfg.compaction?.auto === false) return 0
    const learned = input.sessionID ? learnedLimits.get(input.sessionID) : undefined
    if (learned === undefined) return DEFAULT_USABLE_CONTEXT
    return Math.min(DEFAULT_USABLE_CONTEXT, Math.max(0, learned - reserved(input.cfg, learned)))
  }

  return input.model.limit.input
    ? Math.max(0, input.model.limit.input - reserved(input.cfg, input.model.limit.input))
    : Math.max(0, context - ProviderTransform.maxOutputTokens(input.model, input.outputTokenMax))
}

export function isOverflow(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
  sessionID?: string
}) {
  if (input.cfg.compaction?.auto === false) return false

  const count =
    input.tokens.total || input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write
  return count >= usable(input)
}

// D3: payload for the session.overflow.detected event — the same reported
// token count isOverflow compares, plus usable/reserve with context-budget
// endpoint semantics (reserve is 0 when the model reports no context limit).
export function overflowReport(input: {
  cfg: ConfigV1.Info
  tokens: SessionV1.Assistant["tokens"]
  model: Provider.Model
  outputTokenMax?: number
  sessionID?: string
}) {
  return {
    tokens:
      input.tokens.total ||
      input.tokens.input + input.tokens.output + input.tokens.cache.read + input.tokens.cache.write,
    usable: usable(input),
    reserve: input.model.limit.context ? reserved(input.cfg, input.model.limit.input || input.model.limit.context) : 0,
  }
}
