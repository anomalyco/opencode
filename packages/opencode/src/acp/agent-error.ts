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
import type {
  ApiError,
  ContextOverflowError,
  MessageAbortedError,
  MessageOutputLengthError,
  ProviderAuthError,
  StructuredOutputError,
  UnknownError,
} from "@opencode-ai/sdk/v2"

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

/**
 * Discriminated union of every error variant `EventSessionError.properties.error`
 * may carry, mirroring the SDK definition in
 * `@opencode-ai/sdk/v2`'s generated types.
 */
export type SDKSessionError =
  | ApiError
  | ContextOverflowError
  | ProviderAuthError
  | UnknownError
  | MessageOutputLengthError
  | MessageAbortedError
  | StructuredOutputError

/**
 * Convert an SDK `EventSessionError.properties.error` payload into the
 * typed `LLMErrorPayload` carried on the `agent_error` `session/update`
 * wire shape.
 *
 * Lookup priority:
 *  1. `APIError.responseHeaders["x-llm-error-type"]` — when the upstream
 *     proxy classifies the failure (e.g. `budget`, `rate_limit`) it sets
 *     this header. Highest fidelity.
 *  2. Variant name (`ProviderAuthError` → `auth`, `ContextOverflowError`
 *     → `context_overflow`).
 *  3. Status-code heuristic on `APIError` (401 → `auth`, 5xx → `provider_unavailable`).
 *  4. Fallback to `unknown`.
 *
 * The `retryable` flag is derived from the resulting type via
 * `isRetriable()`, then overridden by the explicit
 * `x-llm-error-retryable` header when present (so a proxy that knows
 * better than the type table — e.g. a temporarily-disabled budget that
 * should not be retried even though `unknown` would normally be — wins).
 */
export function llmErrorPayloadFromSDK(error: SDKSessionError): LLMErrorPayload {
  if (error.name === "ProviderAuthError") {
    return {
      type: "auth",
      message: error.data.message,
      retryable: false,
    }
  }

  if (error.name === "ContextOverflowError") {
    return {
      type: "context_overflow",
      message: error.data.message,
      retryable: false,
    }
  }

  if (error.name === "APIError") {
    return llmErrorPayloadFromApiError(error)
  }

  // MessageOutputLengthError / MessageAbortedError / StructuredOutputError /
  // UnknownError — no proxy classification available; treat as a transient
  // unknown failure.
  const message = "data" in error && "message" in error.data ? (error.data as { message: string }).message : error.name
  return {
    type: "unknown",
    message: message || "Unknown error",
    retryable: true,
  }
}

function llmErrorPayloadFromApiError(error: ApiError): LLMErrorPayload {
  const headers = error.data.responseHeaders ?? {}
  const headerType = readHeader(headers, "x-llm-error-type")
  const headerRetryable = readHeader(headers, "x-llm-error-retryable")
  const resolvedType = resolveTypeFromHeaders(headerType) ?? resolveTypeFromStatus(error.data.statusCode)

  const retryable = (() => {
    if (headerRetryable === "true") return true
    if (headerRetryable === "false") return false
    return isRetriable(resolvedType)
  })()

  const payload: LLMErrorPayload = {
    type: resolvedType,
    message: error.data.message,
    retryable,
  }

  const resetAt = readHeader(headers, "x-llm-error-reset-at")
  if (resetAt !== undefined) {
    const parsed = Number.parseInt(resetAt, 10)
    if (Number.isFinite(parsed)) payload.reset_at_epoch_ms = parsed
  }

  const retryAfter = readHeader(headers, "retry-after")
  if (retryAfter !== undefined) {
    const parsed = Number.parseInt(retryAfter, 10)
    if (Number.isFinite(parsed)) payload.retry_after_seconds = parsed
  }

  return payload
}

function readHeader(headers: Record<string, string>, name: string): string | undefined {
  // Header keys are typically lowercased by fetch / undici / Bun, but
  // accept either casing defensively for non-Bun callers.
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()]
}

function resolveTypeFromHeaders(value: string | undefined): LLMErrorType | undefined {
  if (!value) return undefined
  return (LLM_ERROR_TYPES as readonly string[]).includes(value) ? (value as LLMErrorType) : undefined
}

function resolveTypeFromStatus(status: number | undefined): LLMErrorType {
  if (status === undefined) return "unknown"
  if (status === 401) return "auth"
  if (status >= 500) return "provider_unavailable"
  return "unknown"
}
