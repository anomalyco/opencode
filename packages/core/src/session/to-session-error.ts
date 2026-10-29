import { AIError, ToolFailure, type FinishReasonDetails } from "@opencode/ai/effect"
import { Tool } from "@opencode/schema/tool"
import { SessionError } from "@opencode/schema/session-error"
import { Permission } from "../permission.js"
import { Integration } from "../integration.js"
import { AgentNotFoundError, StepFailedError } from "./error.js"
import { ModelResolver } from "../model-resolver.js"
import { SessionRunnerModel } from "./runner/model.js"

const tokenSharingMessages = {
  subscription_sharing_user_not_eligible:
    "ChatGPT token sharing isn't available for this account. Connect with an API key or choose another provider.",
  subscription_sharing_usage_limit_exceeded:
    "ChatGPT usage limit reached. Check ChatGPT Settings → Usage for details.",
  subscription_sharing_usage_unavailable: "ChatGPT usage can't be checked right now. Try again later.",
  subscription_sharing_unsupported_capability:
    "This request uses a feature ChatGPT token sharing doesn't support. Remove the unsupported feature and try again.",
  subscription_sharing_route_not_supported:
    "ChatGPT token sharing doesn't support this API route. Check the configured endpoint and HTTP method.",
  subscription_sharing_invalid_user: "This ChatGPT connection is no longer valid. Reconnect to ChatGPT.",
  subscription_sharing_user_unavailable: "Your ChatGPT account is temporarily unavailable. Try again later.",
  chatpass_v2_scope_not_authorized:
    "This ChatGPT connection isn't authorized for this request. Reconnect to ChatGPT or choose another connection.",
  chatpass_v2_invalid_authorization_context:
    "This ChatGPT connection isn't authorized for this request. Reconnect to ChatGPT or choose another connection.",
}

const FREE_USAGE_LIMIT_MESSAGE =
  "Free usage limit reached. Connect a provider or subscribe to OpenCode Go to keep going, or switch models."
const BUDGET_LIMIT_MESSAGE = "Workspace usage limit reached. Model use is paused until the limit resets."
const MODEL_BUDGET_LIMIT_MESSAGE = "You've reached the spend limit for this model. Switch models to keep going."

export function toSessionError(cause: unknown): SessionError.Error {
  if (cause instanceof AIError) {
    switch (cause.reason._tag) {
      case "RateLimit":
        return providerError("provider.rate-limit", cause.reason)
      case "Authentication":
        return providerError("provider.auth", cause.reason)
      case "QuotaExceeded":
        if (cause.reason.body?.includes("FreeUsageLimitError"))
          return { ...providerError("provider.free-limit", cause.reason), message: FREE_USAGE_LIMIT_MESSAGE }
        if (cause.reason.body?.includes("BudgetLimitError")) return budgetLimit(cause.reason)
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
      case "UnsupportedOperation":
        return providerError("provider.unsupported-operation", cause.reason)
      case "NoRoute":
        return providerError("provider.no-route", cause.reason)
      case "UnknownProvider":
        return providerError("provider.unknown", cause.reason)
      case "Timeout":
        return providerError("provider.timeout", cause.reason)
      default: {
        const exhaustive: never = cause.reason
        return exhaustive
      }
    }
  }
  if (cause instanceof Permission.BlockedError) return { type: "permission.rejected", message: cause.message }
  if (cause instanceof Permission.CorrectedError) return { type: "permission.rejected", message: cause.feedback }
  if (cause instanceof ToolFailure || cause instanceof Tool.Error) {
    if (cause.error === undefined) return { type: "tool.execution", message: cause.message }
    // The canonical error is the sole model-visible representation, so a cause
    // with no message must not erase the tool's curated failure message.
    const unwrapped = toSessionError(cause.error)
    return unwrapped.message === "" ? { ...unwrapped, type: "tool.execution", message: cause.message } : unwrapped
  }
  if (cause instanceof StepFailedError) return cause.error
  if (cause instanceof ModelResolver.UnsupportedCompactionError)
    return { type: "provider.unsupported-operation", message: cause.message }
  if (cause instanceof AgentNotFoundError) return { type: "unknown", message: cause.message }
  if (
    cause instanceof SessionRunnerModel.ModelNotSelectedError ||
    cause instanceof SessionRunnerModel.ModelUnavailableError ||
    cause instanceof ModelResolver.VariantUnavailableError ||
    cause instanceof ModelResolver.UnsupportedPackageError ||
    cause instanceof ModelResolver.ModelConfigurationError ||
    cause instanceof ModelResolver.ModelInitializationError ||
    cause instanceof ModelResolver.UnresolvedProviderVariablesError
  )
    return { type: "provider.no-route", message: cause.message }
  if (cause instanceof Integration.AuthorizationError) return { type: "provider.auth", message: cause.message }
  return { type: "unknown", message: cause instanceof Error ? cause.message : String(cause) }
}

export function contentFilterError(summary: string, reason: FinishReasonDetails): SessionError.Error {
  return {
    type: "provider.content-filter",
    message: [reason.category === undefined ? summary : `${summary} (${reason.category})`, reason.explanation]
      .filter(Boolean)
      .join(": "),
  }
}

// OpenCode Console names what a refusing budget covers, in its envelope's metadata or, for Google clients, ErrorInfo.
function budgetLimit(reason: AIError["reason"]): SessionError.Error {
  if (/"coverage"\s*:\s*"models"/.test(reason.body ?? ""))
    return { ...providerError("provider.model-budget-limit", reason), message: MODEL_BUDGET_LIMIT_MESSAGE }
  return { ...providerError("provider.budget-limit", reason), message: BUDGET_LIMIT_MESSAGE }
}

function providerError(type: string, reason: AIError["reason"]): SessionError.Error {
  const status = reason.http?.status
  const retryAfterMs = "retryAfterMs" in reason ? reason.retryAfterMs : undefined
  return {
    type,
    message: Object.entries(tokenSharingMessages).find(([code]) => reason.body?.includes(code))?.[1] ?? reason.message,
    ...(status === undefined ? {} : { status }),
    ...(reason.body === undefined ? {} : { response: { body: reason.body } }),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  }
}
