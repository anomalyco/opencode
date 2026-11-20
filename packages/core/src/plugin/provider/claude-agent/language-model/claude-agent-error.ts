export * as ClaudeAgentError from "./claude-agent-error.js"

import type {
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKMessage,
  SDKRateLimitInfo,
} from "@anthropic-ai/claude-agent-sdk"

export const SYNTHETIC_MODEL = "<synthetic>"

export function isSynthetic(message: SDKAssistantMessage) {
  return message.message.model === SYNTHETIC_MODEL
}

export class Failure extends Error {
  constructor(
    message: string,
    readonly limited: boolean,
  ) {
    super(message)
  }
}

// Keep request-local diagnostics until the terminal result. A usage warning alone
// is not a failed request, and Claude Code owns any retries before this result.
export function make() {
  let code: SDKAssistantMessageError | undefined
  let rejected: SDKRateLimitInfo | undefined
  let synthetic = false
  let answered = false
  return (message: SDKMessage): Failure | undefined => {
    if (message.type === "rate_limit_event") {
      rejected = message.rate_limit_info.status === "rejected" ? message.rate_limit_info : undefined
    }
    if (message.type === "stream_event" && message.parent_tool_use_id === null) answered = true
    if (message.type === "assistant" && message.parent_tool_use_id === null) {
      if (message.error) code = message.error
      if (isSynthetic(message)) synthetic = true
      if (!message.error && !isSynthetic(message)) answered = true
    }
    if (message.type !== "result") return

    const status = message.subtype === "success" ? (message.api_error_status ?? undefined) : undefined
    const httpError = status !== undefined && status >= 400
    if (message.subtype === "success" && !message.is_error && !httpError) {
      if (synthetic && !answered) return new Failure("Claude Code returned no response.", false)
      return
    }
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
    const reset = limited && rejected?.resetsAt ? ` Resets at ${new Date(rejected.resetsAt * 1000).toISOString()}.` : ""
    const text = limit + reset

    if (text) return new Failure(text, limited)
    if (status) return new Failure(`Claude Code could not finish its reply (HTTP ${status})`, limited)
    return new Failure("Claude Code could not finish its reply", limited)
  }
}
