import { ProviderError } from "@/provider/error"
import type { Retryable } from "./retry"

export type RecoveryPlan =
  | { type: "fail"; error: unknown }
  | { type: "stop-blocked"; message: string; cause: unknown }
  | { type: "stop-unsafe-tool"; message: string; cause: unknown }
  | { type: "rollback-resume"; message: string; cause: unknown }
  | { type: "rollback-stream-retry"; error: ProviderError.ResponseStreamError }

export function plan(input: {
  error: unknown
  retryable: Retryable | undefined
  blocked: boolean
  attemptHasToolActivity: boolean
  requestHasCommittedToolBoundary: boolean
  attemptCommitted: boolean
  hasAttemptParts: boolean
}): RecoveryPlan {
  if (!input.retryable) return { type: "fail", error: input.error }

  if (input.error instanceof ProviderError.ResponseStreamError && isUnsafeTerminalFailure(input.error)) {
    return { type: "fail", error: input.error }
  }

  if (input.blocked) return { type: "stop-blocked", message: input.retryable.message, cause: input.error }
  if (input.attemptHasToolActivity) {
    return { type: "stop-unsafe-tool", message: input.retryable.message, cause: input.error }
  }

  if (input.requestHasCommittedToolBoundary) {
    return { type: "rollback-resume", message: input.retryable.message, cause: input.error }
  }

  if (!(input.error instanceof ProviderError.ResponseStreamError)) return { type: "fail", error: input.error }
  if (input.error.info.autoReplaySafe) return { type: "fail", error: input.error }
  if (input.attemptCommitted) return { type: "fail", error: input.error }
  if (!input.hasAttemptParts) return { type: "fail", error: input.error }

  return { type: "rollback-stream-retry", error: input.error }
}

export function markAutoReplaySafe(error: ProviderError.ResponseStreamError) {
  return new ProviderError.ResponseStreamError(
    error.message,
    { ...error.info, autoReplaySafe: true },
    { cause: error },
  )
}

function isUnsafeTerminalFailure(error: ProviderError.ResponseStreamError) {
  return error.info.terminalEvent === "response.failed" && !error.info.autoReplaySafe
}

export const SessionStreamRecovery = { plan, markAutoReplaySafe }
