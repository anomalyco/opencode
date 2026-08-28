import { AIError } from "@opencode-ai/ai"
import { errorMessage } from "@opencode-ai/codemode"
import { Tool } from "@opencode-ai/schema/tool"
import { SessionError } from "@opencode-ai/schema/session-error"
import { Permission } from "../permission.js"
import { Integration } from "../integration.js"
import { AgentNotFoundError, StepFailedError, UserInterruptedError } from "./error.js"
import { SessionRunnerModel } from "./runner/model.js"

export function toSessionError(cause: unknown): SessionError.Error {
  if (cause instanceof AIError) {
    switch (cause.reason._tag) {
      case "RateLimit":
        return providerError("provider.rate-limit", cause.reason)
      case "Authentication":
        return providerError("provider.auth", cause.reason)
      case "QuotaExceeded":
        return providerError("provider.quota", cause.reason)
      case "ContentPolicy":
        return providerError("provider.content-filter", cause.reason)
      case "Transport":
        return providerError("provider.transport", cause.reason)
      case "ProviderInternal":
        return providerError("provider.internal", cause.reason)
      case "InvalidProviderOutput":
        return providerError("provider.invalid-output", cause.reason)
      case "InvalidRequest":
        return providerError("provider.invalid-request", cause.reason)
      case "NoRoute":
        return providerError("provider.no-route", cause.reason)
      case "UnknownProvider":
        return providerError("provider.unknown", cause.reason)
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof Permission.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: errorMessage(cause) }
    const unwrapped = toSessionError(cause.error)
    return {
      ...unwrapped,
      ...(unwrapped.message === "" ? { type: "tool.execution" } : {}),
      message: errorMessage(cause),
    }
  }
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: cause.message }
  if (cause instanceof UserInterruptedError) return { type: "aborted", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof SessionRunnerModel.VariantUnavailableError ||
    cause instanceof SessionRunnerModel.UnsupportedPackageError ||
    cause instanceof SessionRunnerModel.UnresolvedProviderVariablesError
  )
    return { type: "provider.no-route", message: cause.message }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: cause.message }
  return { type: "unknown", message: errorMessage(cause) }
}

function providerError(type: string, reason: AIError["reason"]): SessionError.Error {
  const status = reason.http?.status
  return { type, message: reason.message, ...(status === undefined ? {} : { status }) }
}
