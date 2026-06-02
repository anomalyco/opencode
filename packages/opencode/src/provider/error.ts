import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import type { ProviderV2 } from "@opencode-ai/core/provider"

export class HeaderTimeoutError extends Error {
  public override readonly name = "ProviderHeaderTimeoutError"

  constructor(public readonly ms: number) {
    super(`Provider response headers timed out after ${ms}ms`)
  }
}

export class ResponseStreamError extends Error {
  public override readonly name = "ProviderResponseStreamError"

  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
  }
}

// Adapted from overflow detection patterns in:
// https://github.com/badlogic/pi-mono/blob/main/packages/ai/src/utils/overflow.ts
const OVERFLOW_PATTERNS = [
  /prompt is too long/i, // Anthropic
  /input is too long for requested model/i, // Amazon Bedrock
  /exceeds the context window/i, // OpenAI (Completions + Responses API message text)
  /input token count.*exceeds the maximum/i, // Google (Gemini)
  /maximum prompt length is \d+/i, // xAI (Grok)
  /reduce the length of the messages/i, // Groq
  /maximum context length is \d+ tokens/i, // OpenRouter, DeepSeek, vLLM
  /exceeds the limit of \d+/i, // GitHub Copilot
  /exceeds the available context size/i, // llama.cpp server
  /greater than the context length/i, // LM Studio
  /context window exceeds limit/i, // MiniMax
  /exceeded model token limit/i, // Kimi For Coding, Moonshot
  /context[_ ]length[_ ]exceeded/i, // Generic fallback
  /request entity too large/i, // HTTP 413
  /context length is only \d+ tokens/i, // vLLM
  /input length.*exceeds.*context length/i, // vLLM
  /prompt too long; exceeded (?:max )?context length/i, // Ollama explicit overflow error
  /too large for model with \d+ maximum context length/i, // Mistral
  /model_context_window_exceeded/i, // z.ai non-standard finish_reason surfaced as error text
]

function isOpenAiErrorRetryable(e: APICallError) {
  const status = e.statusCode
  if (!status) return e.isRetryable
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || e.isRetryable
}

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
function isOverflow(message: string) {
  if (OVERFLOW_PATTERNS.some((p) => p.test(message))) return true

  // Providers/status patterns handled outside of regex list:
  // - Cerebras: often returns "400 (no body)" / "413 (no body)"
  // - Mistral: often returns "400 (no body)" / "413 (no body)"
  return /^4(00|13)\s*(status code)?\s*\(no body\)/i.test(message)
}

function message(providerID: ProviderV2.ID, e: APICallError) {
  return iife(() => {
    const msg = e.message
    if (msg === "") {
      if (e.responseBody) return e.responseBody
      if (e.statusCode) {
        const err = STATUS_CODES[e.statusCode]
        if (err) return err
      }
      return "Unknown error"
    }

    if (!e.responseBody || (e.statusCode && msg !== STATUS_CODES[e.statusCode])) {
      return msg
    }

    try {
      const body = JSON.parse(e.responseBody)
      // try to extract common error message fields
      const errMsg = body.message || body.error || body.error?.message
      if (errMsg && typeof errMsg === "string") {
        return `${msg}: ${errMsg}`
      }
    } catch {}

    // If responseBody is HTML (e.g. from a gateway or proxy error page),
    // provide a human-readable message instead of dumping raw markup
    if (/^\s*<!doctype|^\s*<html/i.test(e.responseBody)) {
      if (e.statusCode === 401) {
        return "Unauthorized: request was blocked by a gateway or proxy. Your authentication token may be missing or expired — try running `opencode auth login <your provider URL>` to re-authenticate."
      }
      if (e.statusCode === 403) {
        return "Forbidden: request was blocked by a gateway or proxy. You may not have permission to access this resource — check your account and provider settings."
      }
      return msg
    }

    return `${msg}: ${e.responseBody}`
  }).trim()
}

function json(input: unknown) {
  if (typeof input === "string") {
    try {
      const result = JSON.parse(input)
      if (result && typeof result === "object") return result
      return undefined
    } catch {
      return undefined
    }
  }
  if (typeof input === "object" && input !== null) {
    return input
  }
  return undefined
}

export type ParsedStreamError =
  | {
      type: "context_overflow"
      message: string
      responseBody: string
    }
  | {
      type: "api_error"
      message: string
      isRetryable: boolean
      responseBody: string
    }

type StreamErrorRecord = Record<string, unknown>

function streamEnvelopeMessage(body: StreamErrorRecord): string {
  const nested = body.error
  if (!nested || typeof nested !== "object") return "Provider is overloaded"
  const record = nested as StreamErrorRecord
  if (typeof record.message === "string" && record.message.trim() !== "") return record.message
  if (typeof record.code === "string" && record.code.trim() !== "") return record.code
  if (typeof record.type === "string" && record.type.trim() !== "") return record.type
  return "Provider is overloaded"
}

function streamEnvelopeFields(body: StreamErrorRecord) {
  const nested = body.error
  if (!nested || typeof nested !== "object") {
    return { code: "", type: "" }
  }
  const record = nested as StreamErrorRecord
  return {
    code: typeof record.code === "string" ? record.code : "",
    type: typeof record.type === "string" ? record.type : "",
  }
}

function extractStreamEnvelope(value: string): StreamErrorRecord | undefined {
  const direct = json(value)
  if (direct?.type === "error") return direct as StreamErrorRecord

  const marker = value.indexOf('"type":"error"')
  const markerSpaced = value.indexOf('"type": "error"')
  const start = marker === -1 ? markerSpaced : marker
  if (start === -1) return undefined

  const open = value.lastIndexOf("{", start)
  if (open === -1) return undefined

  const slice = value.slice(open)
  const parsed = json(slice)
  if (parsed?.type === "error") return parsed as StreamErrorRecord
  return undefined
}

function normalizeStreamEnvelope(input: unknown): StreamErrorRecord | undefined {
  if (typeof input === "string") {
    return (json(input) as StreamErrorRecord | undefined) ?? extractStreamEnvelope(input)
  }

  const raw = json(input)
  if (!raw) return undefined
  if (raw.type === "error") return raw as StreamErrorRecord
  if (typeof raw.message === "string") {
    return (json(raw.message) as StreamErrorRecord | undefined) ?? extractStreamEnvelope(raw.message)
  }
  return undefined
}

function isTransientOpenAIStreamEnvelope(body: StreamErrorRecord): boolean {
  const { code, type } = streamEnvelopeFields(body)
  if (
    code === "server_error" ||
    code === "server_is_overloaded" ||
    code === "stream_read_error" ||
    code === "rate_limit_error"
  ) {
    return true
  }
  if (
    type === "server_error" ||
    type === "upstream_error" ||
    type === "service_unavailable_error" ||
    type === "rate_limit_error"
  ) {
    return true
  }
  if (code.includes("rate_limit") || code.includes("overloaded") || code.includes("unavailable")) {
    return true
  }
  return false
}

export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const body = normalizeStreamEnvelope(input)
  if (!body) return

  const responseBody = JSON.stringify(body)
  if (body.type !== "error") return

  switch (streamEnvelopeFields(body).code) {
    case "context_length_exceeded":
      return {
        type: "context_overflow",
        message: "Input exceeds context window of this model",
        responseBody,
      }
    case "insufficient_quota":
      return {
        type: "api_error",
        message: "Quota exceeded. Check your plan and billing details.",
        isRetryable: false,
        responseBody,
      }
    case "usage_not_included":
      return {
        type: "api_error",
        message: "To use Codex with your ChatGPT plan, upgrade to Plus: https://chatgpt.com/explore/plus.",
        isRetryable: false,
        responseBody,
      }
    case "invalid_prompt":
      return {
        type: "api_error",
        message: streamEnvelopeMessage(body) === "Provider is overloaded" ? "Invalid prompt." : streamEnvelopeMessage(body),
        isRetryable: false,
        responseBody,
      }
    case "server_is_overloaded":
    case "server_error":
    case "stream_read_error":
    case "rate_limit_error":
      return {
        type: "api_error",
        message: streamEnvelopeMessage(body),
        isRetryable: true,
        responseBody,
      }
  }

  if (!isTransientOpenAIStreamEnvelope(body)) return undefined

  return {
    type: "api_error",
    message: streamEnvelopeMessage(body),
    isRetryable: true,
    responseBody,
  }
}

export type ParsedAPICallError =
  | {
      type: "context_overflow"
      message: string
      responseBody?: string
    }
  | {
      type: "api_error"
      message: string
      statusCode?: number
      isRetryable: boolean
      responseHeaders?: Record<string, string>
      responseBody?: string
      metadata?: Record<string, string>
    }

export function parseAPICallError(input: { providerID: ProviderV2.ID; error: APICallError }): ParsedAPICallError {
  const m = message(input.providerID, input.error)
  const body = json(input.error.responseBody)
  if (isOverflow(m) || input.error.statusCode === 413 || body?.error?.code === "context_length_exceeded") {
    return {
      type: "context_overflow",
      message: m,
      responseBody: input.error.responseBody,
    }
  }

  const metadata = input.error.url ? { url: input.error.url } : undefined
  return {
    type: "api_error",
    message: m,
    statusCode: input.error.statusCode,
    isRetryable: input.providerID.startsWith("openai") ? isOpenAiErrorRetryable(input.error) : input.error.isRetryable,
    responseHeaders: input.error.responseHeaders,
    responseBody: input.error.responseBody,
    metadata,
  }
}

export * as ProviderError from "./error"
