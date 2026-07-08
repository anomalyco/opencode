import { LLMError, ToolFailure } from "@opencode-ai/llm"
import { SessionError } from "@opencode-ai/schema/session-error"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { Integration } from "../integration"
import { ToolOutputStore } from "../tool-output-store"
import { AgentNotFoundError, StepFailedError, UserInterruptedError } from "./error"
import { SessionRunnerModel } from "./runner/model"

export function toSessionError(cause: unknown): SessionError.Error {
  if (cause instanceof LLMError) {
    switch (cause.reason._tag) {
      case "RateLimit":
        return { type: "provider.rate-limit", message: cause.reason.message }
      case "Authentication":
        return { type: "provider.auth", message: cause.reason.message }
      case "QuotaExceeded":
        return { type: "provider.quota", message: cause.reason.message }
      case "ContentPolicy":
        return { type: "provider.content-filter", message: cause.reason.message }
      case "Transport":
        return { type: "provider.transport", message: cause.reason.message }
      case "ProviderInternal":
        return { type: "provider.internal", message: cause.reason.message }
      case "InvalidProviderOutput":
        return { type: "provider.invalid-output", message: cause.reason.message }
      case "InvalidRequest":
        return { type: "provider.invalid-request", message: cause.reason.message }
      case "NoRoute":
        return { type: "provider.no-route", message: cause.reason.message }
      case "UnknownProvider":
        return { type: "provider.unknown", message: cause.reason.message }
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof PermissionV2.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof QuestionV2.RejectedError) return { type: "aborted", message: cause.message }
  if (cause instanceof ToolFailure)
    return cause.error === undefined ? { type: "tool.execution", message: cause.message } : toSessionError(cause.error)
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: cause.message }
  if (cause instanceof UserInterruptedError) return { type: "aborted", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof SessionRunnerModel.VariantUnavailableError ||
    cause instanceof SessionRunnerModel.UnsupportedPackageError
  )
    return { type: "provider.no-route", message: cause.message }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: cause.message }
  if (cause instanceof ToolOutputStore.StorageError) return { type: "unknown", message: cause.message }
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}
