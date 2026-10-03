import { APICallError } from "ai"
import { STATUS_CODES } from "http"
import { iife } from "@/util/iife"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import { isContextOverflow } from "@opencode-ai/llm"

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

function isOpenAiErrorRetryable(e: APICallError) {
  const status = e.statusCode
  if (!status) return e.isRetryable
  // openai sometimes returns 404 for models that are actually available
  return status === 404 || e.isRetryable
}

// Providers not reliably handled in this function:
// - z.ai: can accept overflow silently (needs token-count/context-window checks)
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

export function parseStreamError(input: unknown): ParsedStreamError | undefined {
  const raw = json(input)
  const body = typeof raw?.message === "string" ? (json(raw.message) ?? raw) : raw
  if (!body) return

  const responseBody = JSON.stringify(body)
  if (body.type !== "error") return

  switch (body?.error?.code) {
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
        message: typeof body?.error?.message === "string" ? body?.error?.message : "Invalid prompt.",
        isRetryable: false,
        responseBody,
      }
    case "server_is_overloaded":
    case "server_error":
      return {
        type: "api_error",
        message: typeof body?.error?.message === "string" ? body?.error?.message : "Server error.",
        isRetryable: true,
        responseBody,
      }
  }

  return {
    type: "api_error",
    message: typeof body?.error?.message === "string" ? body.error.message : "Server error.",
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
  const responseBodyText = typeof input.error.responseBody === "string" ? input.error.responseBody : ""
  // message() drops the provider body for generic SDK messages such as
  // "Provider request failed with HTTP 400", so check the raw body too.
  // Otherwise overflow details (or the opaque opencode-go model-only 400)
  // never reach the classifier and compact-and-retry is skipped.
  if (
    isContextOverflow(m) ||
    isContextOverflow(responseBodyText) ||
    isOpaqueModelOnlyRejection(responseBodyText) ||
    input.error.statusCode === 413 ||
    body?.error?.code === "context_length_exceeded"
  ) {
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

// opencode-go fronts multiple upstreams with different context limits. The
// smaller route rejects oversized requests with an unparseable HTTP 400 whose
// body echoes only the model id (31 bytes, no `error`/`message`), e.g.
// `{"model":"deepseek-v4.1-flash"}`. Treat that opaque model-only shape as
// overflow so compact-and-retry runs instead of hard-failing the session.
// Kept local (mirroring @opencode-ai/llm) so classification does not depend
// on the llm package version resolving through the workspace.
function isOpaqueModelOnlyRejection(message: string) {
  const trimmed = message.trim()
  if (trimmed.length === 0 || trimmed.length > 500) return false
  if (!/"model"\s*:/i.test(trimmed)) return false
  if (/"(error|message|code)"\s*:/i.test(trimmed)) return false
  const start = trimmed.indexOf("{")
  const end = trimmed.lastIndexOf("}")
  if (start === -1 || end <= start) return false
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false
    const record = parsed as Record<string, unknown>
    return typeof record.model === "string" && record.error == null && record.message == null
  } catch {
    return false
  }
}

export * as ProviderError from "./error"
