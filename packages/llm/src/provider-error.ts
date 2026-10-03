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

const staleReasoningPatterns = [
  /reasoning.*encrypted_content.*not issued to this caller/i,
  /encrypted_content.*was not issued to this caller/i,
  /invalid_encrypted_content/i,
  /encrypted content could not be (verified|decrypted|parsed)/i,
  /referenced reasoning item .* (was not found|has expired)/i,
  /item .* of type ['"]reasoning['"] was provided without its required following item/i,
]

export const isContextOverflow = (message: string) =>
  !exclusions.some((pattern) => pattern.test(message)) &&
  (patterns.some((pattern) => pattern.test(message)) || /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message))

export const isStaleReasoning = (message: string) => staleReasoningPatterns.some((pattern) => pattern.test(message))

export const isContextOverflowFailure = (failure: unknown) =>
  failure instanceof LLMError
    ? failure.reason._tag === "InvalidRequest" && failure.reason.classification === "context-overflow"
    : Schema.is(ProviderErrorEvent)(failure) && failure.classification === "context-overflow"

const failureText = (failure: unknown) => {
  if (failure instanceof LLMError) return `${failure.message}\n${failure.reason.message}`
  if (Schema.is(ProviderErrorEvent)(failure)) return failure.message
  if (failure instanceof Error) return failure.message
  return ""
}

export const isStaleReasoningFailure = (failure: unknown) => {
  if (
    failure instanceof LLMError &&
    failure.reason._tag === "InvalidRequest" &&
    failure.reason.classification === "stale-reasoning"
  )
    return true
  if (Schema.is(ProviderErrorEvent)(failure) && failure.classification === "stale-reasoning") return true
  return isStaleReasoning(failureText(failure))
}
