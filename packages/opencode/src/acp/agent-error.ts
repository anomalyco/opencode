/**
 * TypeScript mirror of the `agent_error` ACP `session/update` kind.
 *
 * The upstream `@agentclientprotocol/sdk` defines `SessionUpdate` as a
 * closed discriminated union (a `type` alias, not an `interface`).
 * TypeScript's declaration merging only works on interfaces, so we
 * cannot extend `SessionUpdate` via an ambient `.d.ts` augmentation —
 * we have to define our own extended union and use it at the emit site.
 *
 * This file is the local fork extension. The wire shape mirrors the
 * canonical Python definition at:
 *
 *   packages/models/src/models/llm_errors.py    (tn-mono)
 *   services/tn-claw/src/tn_claw/schemas/agent_error.py    (tn-mono)
 *
 * Phase chain:
 *   - Phase 1A: Python contract (tn-mono PR #721, MERGED 2026-05-08)
 *   - Phase 1B: this file (TS mirror in our anomalyco/opencode fork)
 *   - Phase 4:  `session/processor.ts` `halt()` emits an `agent_error`
 *               frame using `SessionUpdateWithAgentError` at its
 *               `connection.sessionUpdate(...)` callsite
 *
 * Spec: `specs/20260508-llm-error-propagation/spec.md`
 */

import type { SessionUpdate } from "@agentclientprotocol/sdk"

/**
 * Closed vocabulary for the category of a failed LLM call.
 *
 * Keep in sync with `LLMErrorType` in
 * `packages/models/src/models/llm_errors.py` (tn-mono).
 */
export const LLM_ERROR_TYPES = [
  "budget", // 429 + type=budget_error — non-retriable
  "rate_limit", // 429 + type=rate_limit_error — bounded retry
  "provider_unavailable", // 5xx — bounded retry
  "context_overflow", // 400 + type=invalid_request_error — non-retriable
  "auth", // 401 — non-retriable; surfaces as connection-level via ch:"error", NOT here
  "unknown", // wall-clock timeout / unparseable — bounded retry
] as const

export type LLMErrorType = (typeof LLM_ERROR_TYPES)[number]

const NON_RETRIABLE: ReadonlySet<LLMErrorType> = new Set<LLMErrorType>([
  "budget",
  "context_overflow",
  "auth",
])

/**
 * Source-of-truth retry classification by error type.
 *
 * Mirrors `is_retriable()` in `packages/models/src/models/llm_errors.py`.
 * All retry policy in opencode (`session/retry.ts`'s `retryable()`) and
 * the frontend should derive from this function rather than maintaining
 * their own tables.
 */
export function isRetriable(type: LLMErrorType): boolean {
  return !NON_RETRIABLE.has(type)
}

/**
 * Wire payload for a typed LLM call failure.
 *
 * Travels intact from origin (tn-api) through every intermediate layer
 * to the rendered chat item. `retryable` is on-the-wire explicit so
 * consumers do not need to keep their own derivation table.
 *
 * Wire shape uses snake_case field names — matches the Python
 * `LLMErrorPayload` and the spec's wire example. Cross-language consumers
 * (tn-claw Python, frontend) read these names verbatim; do not
 * camelCase-alias when serializing.
 *
 * `auth` is included in `LLMErrorType` for completeness but is NOT
 * valid on the `agent_error` `session/update` path — auth failures
 * occur before a session exists; emit them as `ch:"error"` with a
 * `WebSocketErrorCode` instead.
 */
export interface LLMErrorPayload {
  type: LLMErrorType
  message: string
  detail?: Record<string, unknown>
  retryable: boolean
  retry_after_seconds?: number | null
  reset_at_epoch_ms?: number | null
  source?: string | null
}

/**
 * The `agent_error` session/update envelope.
 *
 * Shape mirrors the SDK's other discriminated-union members
 * (e.g. `{ sessionUpdate: "tool_call", ...ToolCall }`).
 */
export interface AgentErrorUpdate {
  sessionUpdate: "agent_error"
  error: LLMErrorPayload
  /**
   * Mirrors the SDK's `stopReason` field on chunk-shaped updates.
   * Always `"error"` for this kind; included so `session/update`
   * consumers can clear streaming state without special-casing.
   */
  stopReason?: "error"
}

/**
 * Local extension of the SDK's closed `SessionUpdate` union.
 *
 * Phase 4's emit site (`session/processor.ts` `halt()`) should pass an
 * `AgentErrorUpdate` to `connection.sessionUpdate(...)` typed as
 * `SessionUpdateWithAgentError`. We intentionally do NOT cast the
 * value to the upstream `SessionUpdate` — that would lose the typed
 * `error` field in callers. Instead, emit code uses this superset.
 *
 * Once `@agentclientprotocol/sdk` adopts `agent_error` upstream, drop
 * this type alias and import the new SDK literal directly.
 */
export type SessionUpdateWithAgentError = SessionUpdate | AgentErrorUpdate

/**
 * Type guard for narrowing an unknown session/update to the
 * `agent_error` kind. Mirrors `parse_agent_error()` on the Python side.
 *
 * Returns `false` for any other kind, including malformed shapes;
 * the caller does not need a try/catch around it.
 */
export function isAgentErrorUpdate(update: unknown): update is AgentErrorUpdate {
  if (!update || typeof update !== "object") return false
  const u = update as { sessionUpdate?: unknown; error?: unknown }
  if (u.sessionUpdate !== "agent_error") return false
  return isLLMErrorPayload(u.error)
}

function isLLMErrorPayload(value: unknown): value is LLMErrorPayload {
  if (!value || typeof value !== "object") return false
  const p = value as { type?: unknown; message?: unknown; retryable?: unknown }
  if (typeof p.message !== "string") return false
  if (typeof p.retryable !== "boolean") return false
  if (typeof p.type !== "string") return false
  return (LLM_ERROR_TYPES as readonly string[]).includes(p.type)
}
