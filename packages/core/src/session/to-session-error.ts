import { LLMError, ToolFailure } from "@opencode-ai/llm"
import { Tool } from "@opencode-ai/plugin/v2/effect/tool"
import { SessionError } from "@opencode-ai/schema/session-error"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { Integration } from "../integration"
import { ToolOutputStore } from "../tool-output-store"
import { AgentNotFoundError, StepFailedError, UserInterruptedError } from "./error"
import { SessionRunnerModel } from "./runner/model"

const HTML_DOCUMENT = /<(?:!doctype\s+html|html|head|body)(?:\s|>)/i
const HTTP_STATUS = /\bHTTP\s+(\d{3})\b/i
const STATUS_CODE = /\b([45]\d{2})\b/

/** Bound provider HTML/nginx bodies so retry notices stay human-readable in the TUI. */
export function sanitizeErrorMessage(message: string, status?: number): string {
  if (!HTML_DOCUMENT.test(message)) return message
  const code = status ?? Number(message.match(HTTP_STATUS)?.[1] ?? message.match(STATUS_CODE)?.[1] ?? NaN)
  if (Number.isFinite(code) && code >= 500) return `Provider temporarily unavailable (HTTP ${code})`
  if (Number.isFinite(code)) return `Provider request failed (HTTP ${code})`
  return "Provider request failed"
}

function message(value: string, status?: number) {
  return sanitizeErrorMessage(value, status)
}

export function toSessionError(cause: unknown): SessionError.Error {
  if (cause instanceof LLMError) {
    switch (cause.reason._tag) {
      case "RateLimit":
        return { type: "provider.rate-limit", message: message(cause.reason.message) }
      case "Authentication":
        return { type: "provider.auth", message: message(cause.reason.message) }
      case "QuotaExceeded":
        return { type: "provider.quota", message: message(cause.reason.message) }
      case "ContentPolicy":
        return { type: "provider.content-filter", message: message(cause.reason.message) }
      case "Transport":
        return { type: "provider.transport", message: message(cause.reason.message) }
      case "ProviderInternal":
        return {
          type: "provider.internal",
          message: message(cause.reason.message, cause.reason.status),
        }
      case "InvalidProviderOutput":
        return { type: "provider.invalid-output", message: message(cause.reason.message) }
      case "InvalidRequest":
        return { type: "provider.invalid-request", message: message(cause.reason.message) }
      case "NoRoute":
        return { type: "provider.no-route", message: message(cause.reason.message) }
      case "UnknownProvider":
        return { type: "provider.unknown", message: message(cause.reason.message) }
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof PermissionV2.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof QuestionV2.RejectedError) return { type: "aborted", message: cause.message }
  if (cause instanceof ToolFailure || cause instanceof Tool.Failure)
    return cause.error === undefined
      ? { type: "tool.execution", message: message(cause.message) }
      : toSessionError(cause.error)
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: message(cause.message) }
  if (cause instanceof UserInterruptedError) return { type: "aborted", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof SessionRunnerModel.VariantUnavailableError ||
    cause instanceof SessionRunnerModel.UnsupportedPackageError
  )
    return { type: "provider.no-route", message: message(cause.message) }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: message(cause.message) }
  if (cause instanceof ToolOutputStore.StorageError) return { type: "unknown", message: message(cause.message) }
  return {
    type: "unknown",
    message: message(cause instanceof Error ? cause.message : String(cause)),
  }
}
