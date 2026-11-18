export * as ClaudeAgentError from "./claude-agent-error.js"

import type { SDKAssistantMessageError, SDKMessage, SDKRateLimitInfo } from "@anthropic-ai/claude-agent-sdk"
import { AIError, QuotaExceededError } from "@opencode/ai/effect"

export class Failure extends Error {
  constructor(
    message: string,
    // A subscription limit refused the request, rather than an API error that Claude Code already retried.
    readonly limited: boolean,
    // Epoch milliseconds when that limit resets, when Claude Code reported it.
    readonly resetsAt?: number,
  ) {
    super(message)
  }
}

// A limit refusal arrives without an HTTP status, so opencode would classify it by its text, and Claude Code's limit
// wording matches none of opencode's patterns. Naming it a quota error lets `session.retry` hooks, such as one that
// switches accounts, recognise it and learn when the limit resets.
export function quota(failure: Failure, now: number) {
  return new AIError({
    reason: new QuotaExceededError({
      message: failure.message,
      retryAfterMs: failure.resetsAt === undefined ? undefined : Math.max(0, Math.ceil(failure.resetsAt - now)),
      cause: failure,
    }),
  })
}

// Keep request-local diagnostics until the terminal result. A usage warning alone
// is not a failed request, and Claude Code owns any retries before this result.
export function make() {
  let code: SDKAssistantMessageError | undefined
  let rejected: SDKRateLimitInfo | undefined
  return (message: SDKMessage): Failure | undefined => {
    if (message.type === "rate_limit_event") {
      rejected = message.rate_limit_info.status === "rejected" ? message.rate_limit_info : undefined
    }
    if (message.type === "assistant" && message.parent_tool_use_id === null && message.error) code = message.error
    if (message.type !== "result") return

    const status = message.subtype === "success" ? (message.api_error_status ?? undefined) : undefined
    const httpError = status !== undefined && status >= 400
    if (message.subtype === "success" && !message.is_error && !httpError) return
    const result = (message.subtype === "success" ? message.result : message.errors.join("\n")).replaceAll(
      "Please run /login",
      "Run `claude auth login` in a terminal",
    )
    const failure =
      status !== undefined && status >= 500
        ? (status === 529 ? "Anthropic is overloaded (529)." : `Anthropic returned HTTP ${status}.`) +
          " Claude Code exhausted its retries. Try again shortly."
        : result
    const limited = code === "rate_limit" || (rejected !== undefined && status === 429)
    const window = rejected?.rateLimitType?.replaceAll("_", " ")
    const limit =
      limited && !failure ? `Claude Code subscription limit reached${window ? ` (${window})` : ""}.` : failure
    const resetsAt = limited && rejected?.resetsAt ? rejected.resetsAt * 1000 : undefined
    const reset = resetsAt ? ` Resets at ${new Date(resetsAt).toISOString()}.` : ""
    const text = limit + reset

    if (text) return new Failure(text, limited, resetsAt)
    if (status) return new Failure(`Claude Code could not finish its reply (HTTP ${status})`, limited, resetsAt)
    return new Failure("Claude Code could not finish its reply", limited, resetsAt)
  }
}
