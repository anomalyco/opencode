import { AIError, ToolFailure } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import { SessionError } from "@opencode-ai/schema/session-error"
import { PlatformError } from "effect/PlatformError"
import { Permission } from "../permission"
import { Question } from "../question"
import { Integration } from "../integration"
import { AgentNotFoundError, StepFailedError, UserInterruptedError } from "./error"
import { SessionRunnerModel } from "./runner/model"

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
  if (cause instanceof Question.RejectedError) return { type: "aborted", message: cause.message }
  if (cause instanceof ToolFailure || cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: cause.message }
    const unwrapped = toSessionError(cause.error)
    return cause.error instanceof PlatformError
      ? { ...unwrapped, message: `${cause.message}: ${platformErrorMessage(cause.error)}` }
      : unwrapped
  }
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
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}

function providerError(type: string, reason: AIError["reason"]): SessionError.Error {
  const status =
    ("http" in reason ? reason.http?.response?.status : undefined) ?? ("status" in reason ? reason.status : undefined)
  return { type, message: reason.message, ...(status === undefined ? {} : { status }) }
}

function platformErrorMessage(error: PlatformError) {
  const reason = error.reason
  if (reason._tag === "BadArgument")
    return `${reason.module}.${reason.method} rejected an invalid argument${reason.description ? `: ${reason.description}` : ""}`

  const label = (() => {
    switch (reason._tag) {
      case "AlreadyExists":
        return "already exists"
      case "BadResource":
        return "resource is invalid or closed"
      case "Busy":
        return "resource is busy"
      case "InvalidData":
        return "invalid data"
      case "NotFound":
        return "not found"
      case "PermissionDenied":
        return "permission denied"
      case "TimedOut":
        return "timed out"
      case "UnexpectedEof":
        return "unexpected end of input"
      case "Unknown":
        return "system error"
      case "WouldBlock":
        return "would block"
      case "WriteZero":
        return "wrote zero bytes"
    }
  })()
  const target = reason.pathOrDescriptor === undefined ? "" : `: ${reason.pathOrDescriptor}`
  const description = reason.description === undefined ? "" : ` (${reason.description})`
  return `${reason.module}.${reason.method} failed: ${label}${target}${description}`
}
