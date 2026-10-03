import { Schema } from "effect"
import { LLMError, ProviderErrorEvent } from "./schema"

const patterns = [
  /prompt is too long/i,
  /request_too_large/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /exceeds (?:the )?(?:model'?s )?maximum context length(?: of [\d,]+ tokens?|\s*\([\d,]+\))/i,
  /input token count.*exceeds the maximum/i,
  /tokens in request more than max tokens allowed/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /exceeds (?:the )?maximum allowed input length of [\d,]+ tokens?/i,
  /input \(\d+ tokens\) is longer than the model'?s context length \(\d+ tokens\)/i,
  /exceeds the limit of \d+/i,
  /exceeds the available context size/i,
  /greater than the context length/i,
  /context window exceeds limit/i,
  /exceeded model token limit/i,
  /context[_ ]length[_ ]exceeded/i,
  /request entity too large/i,
  /context length is only \d+ tokens/i,
  /input length.*exceeds.*context length/i,
  /prompt too long; exceeded (?:max )?context length/i,
  /too large for model with \d+ maximum context length/i,
  /prompt has [\d,]+ tokens?, but the configured context size is [\d,]+ tokens?/i,
  /model_context_window_exceeded/i,
  /too many tokens/i,
  /token limit exceeded/i,
]

const exclusions = [/^(throttling error|service unavailable):/i, /rate limit/i, /too many requests/i]

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) ||
    /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message) ||
    isOpaqueModelOnlyRejection(message))

// opencode-go fronts multiple upstreams with different context limits. The
// smaller route rejects oversized requests with an unparseable HTTP 400 whose
// body echoes only the model id (31 bytes, no `error`/`message`), e.g.
// `{"model":"deepseek-v4.1-flash"}`. Treat that opaque model-only shape as
// overflow so compact-and-retry runs instead of hard-failing the session.
const isOpaqueModelOnlyRejection = (message: string) => {
  const trimmed = message.trim()
  if (trimmed.length === 0 || trimmed.length > 500) return false
  if (!/"model"\s*:/i.test(trimmed)) return false
  if (/"(error|message|code)"\s*:/i.test(trimmed)) return false
  const candidate = extractJsonObject(trimmed)
  if (!candidate) return false
  try {
    const parsed = JSON.parse(candidate) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return typeof record.model === "string" && record.error == null && record.message == null
  } catch {
    return false
  }
}

const extractJsonObject = (message: string) => {
  const start = message.indexOf("{")
  const end = message.lastIndexOf("}")
  if (start === -1 || end <= start) return undefined
  return message.slice(start, end + 1)
}

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"
