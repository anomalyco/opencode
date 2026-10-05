import { Cause, Duration, Effect, Schedule } from "effect"
import { LLMError, isContextOverflowFailure } from "@opencode-ai/llm"
import type { RetryError } from "../event"

/** Maximum provider-turn retries before the failure is surfaced to the session. */
export const RETRY_MAX_RETRIES = 5
/** Base delay (ms) for exponential backoff before the first retry. */
export const RETRY_INITIAL_DELAY = 2000
/** Backoff multiplier applied between consecutive retries. */
export const RETRY_BACKOFF_FACTOR = 2
/** Jitter factor (0–1) applied to the exponential delay. */
export const RETRY_JITTER = 0.25
/** Cap applied when no Retry-After hint is supplied by the provider. */
export const RETRY_MAX_DELAY_NO_HEADERS = 30_000
/** Hard cap on any individual retry delay, including Retry-After hints. */
export const RETRY_MAX_DELAY = 30_000

/**
 * Recovery policy limits shared by the provider-retry slice of Phase 11.
 * Only `maxRetries` is wired into the turn loop today; the token/time/tool
 * limits integrate with the existing compaction and interrupt layers and are
 * reserved as named policy caps so callers can reason about them.
 */
export interface RecoveryLimits {
  /** Maximum provider-turn retries (see {@link RETRY_MAX_RETRIES}). */
  readonly maxRetries: number
  /** Maximum output tokens the agent may consume before ContextCompaction is forced. */
  readonly maxTokens: number
  /** Maximum wall-clock duration (ms) for a single session before HumanEscalation. */
  readonly maxExecutionTime: number
  /** Maximum consecutive tool failures before TaskDecomposition / HumanEscalation. */
  readonly maxToolFailures: number
}

export const DEFAULT_RECOVERY_LIMITS: RecoveryLimits = {
  maxRetries: RETRY_MAX_RETRIES,
  maxTokens: 200_000,
  maxExecutionTime: 600_000,
  maxToolFailures: 5,
}

function cap(ms: number) {
  return Math.min(ms, RETRY_MAX_DELAY)
}

function exponential(attempt: number, random = Math.random()): number {
  const base = RETRY_INITIAL_DELAY * Math.pow(RETRY_BACKOFF_FACTOR, attempt - 1)
  return Math.ceil(base + base * RETRY_JITTER * random)
}

/**
 * Classifies a turn failure as retryable at the provider level.
 *
 * Context-overflow failures are intentionally excluded — they are recovered by
 * compaction, not by retrying the same oversized request (see Phase 9).
 */
export function retryable(error: unknown): boolean {
  if (isContextOverflowFailure(error)) return false
  return error instanceof LLMError && error.retryable
}

/**
 * Delay (ms) before the next retry attempt. Honours a provider-supplied
 * Retry-After / retry-after-ms hint, otherwise falls back to exponential
 * backoff with jitter.
 */
export function retryDelay(
  attempt: number,
  retryAfterMs?: number,
  random = Math.random(),
): number {
  if (retryAfterMs && retryAfterMs > 0) return cap(retryAfterMs)
  return cap(Math.min(exponential(attempt, random), RETRY_MAX_DELAY_NO_HEADERS))
}

/** Classifies an LLMError into the wire-shaped RetryError payload for events. */
export function toRetryError(error: LLMError): RetryError {
  const { reason } = error
  const http = "http" in reason ? reason.http : undefined
  return {
    message: error.message,
    isRetryable: reason.retryable,
    statusCode: http?.response?.status,
    responseHeaders: http?.response?.headers,
    responseBody: http?.body,
  }
}

/** Parsed retry metadata extracted from a turn failure. */
export interface RetryInfo {
  /** The LLMError that will be reported by the next attempt. */
  readonly llmError: LLMError
  /** Provider-supplied Retry-After hint (ms), if any. */
  readonly retryAfterMs: number | undefined
}

export interface RetryContext {
  readonly attempt: number
  readonly retryInfo: RetryInfo
}

/**
 * Builds the provider-turn retry schedule used by the V2 session runner.
 *
 * Mirrors the proven V1 schedule in `opencode/src/session/retry.ts`: a
 * `Schedule.fromStepWithMetadata` whose step inspects the failure, classifies
 * retryability via {@link retryable}, honours {@link retryDelay} (incl. Retry-After),
 * and invokes {@link PolicyOptions.set} to publish a `Retried` event before each
 * backoff. Non-retryable failures and the overflow/compaction path (which reach
 * the runner as defects, not errors) are left untouched so they surface as-is.
 */
export interface PolicyOptions {
  parse: (error: unknown) => RetryInfo | undefined
  set: (ctx: RetryContext) => Effect.Effect<unknown>
}

export function policy(opts: PolicyOptions) {
  return Schedule.fromStepWithMetadata(
    Effect.succeed((meta: Schedule.InputMetadata<unknown>) => {
      const retryInfo = opts.parse(meta.input)
      if (!retryInfo || !retryable(retryInfo.llmError)) return Cause.done(meta.attempt)
      if (meta.attempt > RETRY_MAX_RETRIES) return Cause.done(meta.attempt)
      return Effect.gen(function* () {
        const delay = retryDelay(meta.attempt, retryInfo.retryAfterMs)
        yield* opts.set({ attempt: meta.attempt, retryInfo })
        return [meta.attempt, Duration.millis(delay)] as [number, Duration.Duration]
      })
    }),
  )
}

export * as ProviderRetry from "./retry"
