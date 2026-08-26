import { AIError, ToolFailure } from "@opencode-ai/ai"
import { Schema } from "effect"
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
        return providerError("provider.rate-limit", cause)
      case "Authentication":
        return providerError("provider.auth", cause)
      case "QuotaExceeded":
        return providerError("provider.quota", cause)
      case "ContentPolicy":
        return providerError("provider.content-filter", cause)
      case "Transport":
        return providerError("provider.transport", cause)
      case "ProviderInternal":
        return providerError("provider.internal", cause)
      case "InvalidProviderOutput":
        return providerError("provider.invalid-output", cause)
      case "InvalidRequest":
        return providerError("provider.invalid-request", cause)
      case "NoRoute":
        return providerError("provider.no-route", cause)
      case "UnknownProvider":
        return providerError("provider.unknown", cause)
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof Permission.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof ToolFailure || cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: cause.message }
    // The canonical error is the sole model-visible representation, so a cause
    // with no message must not erase the tool's curated failure message.
    const unwrapped = toSessionError(cause.error)
    return unwrapped.message === "" ? { ...unwrapped, type: "tool.execution", message: cause.message } : unwrapped
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
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}

function providerError(type: string, error: AIError): SessionError.Error {
  return {
    type,
    message: error.message,
    ...(error.http === undefined ? {} : { status: error.http.status, http: { ...error.http } }),
    ...(error.body === undefined ? {} : { body: error.body }),
    reason: Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Json))(
      Schema.encodeSync(Schema.toCodecJson(AIError.fields.reason))(error.reason),
    ),
    ...(error.cause === undefined ? {} : { cause: serializeCause(error.cause) }),
  }
}

function serializeCause(cause: unknown): Schema.Json {
  try {
    // Inspect the original value before toJSON() can expose SDK request payloads.
    const json = JSON.stringify(cause, function (this: Record<string, unknown>, key, value: unknown) {
      const original = this[key]
      if (!(original instanceof Error)) return value
      return {
        name: original.name,
        message: original.message,
        stack: original.stack,
        code: "code" in original ? original.code : undefined,
        cause: original.cause,
      }
    })
    return json === undefined ? String(cause) : Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Json))(json)
  } catch {
    return String(cause)
  }
}
