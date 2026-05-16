import crypto from "crypto"

// ─── NVIDIA NIM Provider Detection ──────────────────────────────────

export interface NimDefenseOptions {
  /** Max retries for NIM transient failures (default: 3) */
  nimRetries?: number
  /** Base delay in ms for retry backoff (default: 1000) */
  nimRetryDelay?: number
}

/**
 * Detect whether the given provider config is an NVIDIA NIM endpoint.
 * Multi-factor detection: provider ID, npm package, and base URL.
 */
export function isNimProvider(
  providerID: string,
  npm: string,
  baseURL?: string,
): boolean {
  if (npm === "@ai-sdk/openai-compatible" && providerID === "nvidia") {
    return true
  }
  if (baseURL?.includes("nvidia.com") || baseURL?.includes("api.nvidia.com")) {
    return true
  }
  // Fallback: openai-compatible provider with nvidia in the provider ID
  if (npm === "@ai-sdk/openai-compatible" && providerID.toLowerCase().includes("nvidia")) {
    return true
  }
  return false
}

// ─── Model ID Normalization ─────────────────────────────────────────

/**
 * Fix #22493: deduplicate `nvidia/nvidia/` prefix in model IDs.
 * Handles 2+ levels. Idempotent.
 */
export function normalizeNvidiaModelId(modelId: string): string {
  return modelId.replace(/^(nvidia\/)+/, "nvidia/")
}

// ─── JSON Repair ────────────────────────────────────────────────────

/**
 * Attempt JSON.parse first; only repair on failure.
 * Repair pipeline:
 *  1. Remove trailing commas before ] and }
 *  2. Context-aware single-quote replacement:
 *     Only replace single quotes used as JSON string delimiters
 *     (after `{`, `,`, `[`, `:`, whitespace boundaries),
 *     NOT apostrophes inside string values like "it's".
 *  3. Convert Python literals (True/False/None) to JSON equivalents
 *  4. Brace balancing (only counts braces outside string values)
 */
export function repairMalformedJson(jsonStr: string): string {
  // First attempt: maybe it's already valid
  try {
    JSON.parse(jsonStr)
    return jsonStr
  } catch {
    // Proceed with repair
  }

  // 1. Remove trailing commas before ] and }
  let repaired = jsonStr.replace(/,\s*([}\]])/g, "$1")

  // 2. Context-aware single-quote replacement:
  //    Only replace `'` at JSON token boundaries to preserve apostrophes.
  repaired = replaceSingleQuotesSafely(repaired)

  // 2b. Fix escaped single quotes inside now-double-quoted strings:
  //     JSON doesn't recognize \' escapes. Single quotes inside
  //     double-quoted strings don't need escaping at all.
  //     e.g. {"msg": "it\'s broken"} → {"msg": "it's broken"}
  repaired = repaired.replace(/\\'/g, "'")

  // 3. Convert Python literals
  repaired = repaired.replace(/\b(True|False|None)\b/g, (_, m: string) =>
    m === "True" ? "true" : m === "False" ? "false" : "null",
  )

  // 4. Brace balancing (only count braces outside string values)
  const openBraces = countBracesOutsideStrings(repaired, "{")
  const closeBraces = countBracesOutsideStrings(repaired, "}")
  if (openBraces > closeBraces) {
    repaired += "}".repeat(openBraces - closeBraces)
  }

  return repaired
}

/**
 * Context-aware replacement of single quotes used as JSON delimiters.
 * Only replaces single quotes that appear OUTSIDE double-quoted string values.
 */
/**
 * Context-aware replacement of single quotes used as JSON delimiters.
 *
 * Strategy: replace `'` with `"` only when it appears at a JSON token
 * boundary — preceded by `{`, `,`, `:`, `[`, or whitespace (opening), or
 * followed by `}`, `:`, `,`, `]`, or whitespace (closing). This
 * preserves apostrophes INSIDE string values like `"it's fine"` while
 * fixing malformed JSON that uses single quotes as property/value
 * delimiters like `{'key': 'value'}`.
 */
function replaceSingleQuotesSafely(str: string): string {
  // Replace opening single quotes: preceded by structural chars or whitespace
  let result = str.replace(/(?<=[\s{:,[])'/g, '"')
  // Replace closing single quotes: followed by structural chars or whitespace
  result = result.replace(/'(?=[\s}:,\]])/g, '"')
  return result
}

/**
 * Count occurrences of a brace character outside of double-quoted string values.
 * This prevents unbalanced braces inside string values from corrupting the count.
 */
function countBracesOutsideStrings(str: string, brace: "{" | "}"): number {
  let inString = false
  let escapeNext = false
  let count = 0

  for (const c of str) {
    if (escapeNext) {
      escapeNext = false
      continue
    }
    if (c === "\\") {
      escapeNext = true
      continue
    }
    if (c === '"') {
      inString = !inString
      continue
    }
    if (!inString && c === brace) {
      count++
    }
  }

  return count
}

// ─── Response Normalization ─────────────────────────────────────────

interface NimToolCall {
  id?: string | number | null
  type?: string
  function?: {
    name?: string
    arguments?: string | object
  }
}

interface NimChoiceMessage {
  content?: string | unknown[] | null
  tool_calls?: NimToolCall[] | null
}

interface NimChoice {
  message?: NimChoiceMessage | null
}

interface NimResponse {
  id?: string | null
  choices?: NimChoice[] | null
  [key: string]: unknown
}

/**
 * Normalize a raw NIM API response to be compliant with OpenAI response schema.
 *
 * Fixes:
 *  - Missing/numeric/null tool_call.id
 *  - Raw object arguments → JSON string
 *  - Malformed JSON arguments
 *  - Thinking block leakage (<thinking> and <think>)
 *  - Missing top-level response.id
 *
 * Valid responses pass through unchanged (defensive copy via structuredClone).
 */
export function normalizeNimResponse(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw

  const normalized = structuredClone(raw) as NimResponse

  // Fix top-level response.id
  if (normalized.id === undefined || normalized.id === null || typeof normalized.id !== "string") {
    normalized.id = `nim_${crypto.randomUUID()}`
  }

  if (!Array.isArray(normalized.choices)) return normalized

  for (const choice of normalized.choices) {
    const message = choice?.message
    if (!message) continue

    // Strip reasoning leakage from content (string content only)
    if (typeof message.content === "string") {
      // Remove entire think/thinking blocks AND leftover unpaired tags
      message.content = message.content
        .replace(/<think>[\s\S]*?<\/think>/gi, "")
        .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
        .replace(/<\/?think(?:ing)?>/gi, "")
    }
    // Content arrays pass through untouched

    // Fix tool_calls
    if (!Array.isArray(message.tool_calls)) continue

    for (const tool of message.tool_calls) {
      if (!tool || typeof tool !== "object") continue

      // Fix id: ensure string
      if (tool.id === undefined || tool.id === null) {
        tool.id = `call_${crypto.randomUUID()}`
      } else if (typeof tool.id === "number") {
        tool.id = String(tool.id)
      }

      if (!tool.function) continue

      // Fix arguments: object → JSON string
      if (typeof tool.function.arguments === "object" && tool.function.arguments !== null) {
        tool.function.arguments = JSON.stringify(tool.function.arguments)
      }

      // Fix arguments: malformed JSON repair
      if (typeof tool.function.arguments === "string") {
        tool.function.arguments = repairMalformedJson(tool.function.arguments)
      }
    }
  }

  return normalized
}

// ─── Request Enrichment ─────────────────────────────────────────────

// Known reasoning models and their required chat_template_kwargs.
// NOTE: This is a static map. New NIM reasoning models may require additions.
// The fallback heuristic below catches unknown reasoning model variants.
const REASONING_MODEL_KWARGS: Record<string, Record<string, unknown>> = {
  "deepseek-ai/deepseek-v4": { enable_thinking: true, thinking: true },
  "moonshotai/kimi-k2": { thinking: true },
  "z-ai/glm-5": { enable_thinking: true, clear_thinking: false },
}

// Keywords that suggest a model uses reasoning/capabilities that need
// chat_template_kwargs. Used as fallback for unknown reasoning model variants.
const REASONING_KEYWORDS = [
  "deepseek",
  "kimi",
  "k2",
  "k2p",
  "glm",
  "qwen",
  "reasoning",
  "think",
  "qwq",
]

/**
 * Inject chat_template_kwargs into the request body for reasoning models.
 * Falls back to conservative keyword-based heuristic for unknown variants.
 * Logs a warning if user kwargs conflict with known-required kwargs.
 */
export function enrichNimRequest(
  body: Record<string, unknown>,
  modelId: string,
  log?: (msg: string) => void,
): Record<string, unknown> {
  const result = { ...body }
  const modelLower = modelId.toLowerCase()
  const existing = (result.chat_template_kwargs as Record<string, unknown> | undefined) ?? {}

  // Check static map first
  let defaults: Record<string, unknown> | undefined
  for (const [prefix, kwargs] of Object.entries(REASONING_MODEL_KWARGS)) {
    if (modelId.includes(prefix)) {
      defaults = kwargs
      break
    }
  }

  // Fallback heuristic: keyword match
  if (!defaults) {
    const hasReasoningKeyword = REASONING_KEYWORDS.some((kw) => modelLower.includes(kw))
    if (hasReasoningKeyword) {
      defaults = { enable_thinking: true, thinking: true }
    }
  }

  if (defaults) {
    // Warn if user kwargs contradict known-required kwargs
    if (log) {
      for (const [key, val] of Object.entries(defaults)) {
        if (key in existing && existing[key] !== val) {
          log(
            `[NIM] chat_template_kwargs.${key} is ${JSON.stringify(existing[key])} but ${JSON.stringify(val)} is required for reasoning model ${modelId}. The model may hang or behave unexpectedly.`,
          )
        }
      }
    }

    result.chat_template_kwargs = { ...defaults, ...existing }
  }

  return result
}

// ─── Retry & Resilience ─────────────────────────────────────────────

export interface NimRetryOptions {
  /** Max retries (default: 3) */
  maxRetries?: number
  /** Base delay in ms (default: 1000) */
  baseDelay?: number
  /** Sleep function for testability (default: setTimeout-based) */
  sleepFn?: (ms: number) => Promise<void>
  /** External abort signal for user cancellation */
  signal?: AbortSignal
  /** Logger */
  log?: (msg: string) => void
}

const DEFAULT_RETRY_OPTIONS = {
  maxRetries: 3,
  baseDelay: 1000,
  sleepFn: (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  signal: undefined as AbortSignal | undefined,
  log: undefined as ((msg: string) => void) | undefined,
}

/**
 * Check if an error message indicates a retryable NIM failure.
 * Used as fallback when error.name doesn't match known class names.
 */
function isMessageBasedRetryable(msg: string): boolean {
  const lower = msg.toLowerCase()
  return (
    lower.includes("invalidresponsedataerror") ||
    lower.includes("expected 'id' to be a string") ||
    lower.includes("nim http 200 error") ||
    lower.includes("nim error payload") ||
    lower.includes("nim unexpected text") ||
    lower.includes("nim http 429") ||
    lower.includes("nim http 5") ||
    lower.includes("nim http 50")
  )
}

/**
 * Detect HTTP 200 error payloads from NIM.
 * Content-type aware: only keyword-match for text/plain responses.
 * JSON responses are checked structurally for error field.
 */
async function detectHttp200Error(res: Response): Promise<{ isError: boolean; errorText?: string }> {
  const contentType = (res.headers.get("content-type") || "").toLowerCase()

  // Text/plain or text/html: keyword match
  if (contentType.includes("text/plain") || contentType.includes("text/html")) {
    const text = await res.text()
    // Narrow keyword matching: only check in text/plain responses
    if (
      text.includes("unavailable") ||
      text.includes("rate limit") ||
      (text.includes("error") && !text.includes("no error"))
    ) {
      return { isError: true, errorText: text.slice(0, 500) }
    }
    // Unexpected text response — treat as error to avoid processing garbage
    return { isError: text.length > 0 && text[0] !== "{", errorText: text.slice(0, 200) }
  }

  // JSON: check structurally
  if (contentType.includes("json")) {
    try {
      const body = await res.json()
      if (body?.error) {
        return { isError: true, errorText: JSON.stringify(body.error).slice(0, 500) }
      }
      return { isError: false }
    } catch {
      return { isError: true, errorText: "Failed to parse JSON response" }
    }
  }

  return { isError: false }
}

/**
 * Fetch wrapper with NIM defense layers.
 * Wraps BOTH fetch and normalizeNimResponse as a single retry unit.
 *
 * Only retries:
 *  - AI_InvalidResponseDataError (by name AND message pattern)
 *  - HTTP 429 (rate limited)
 *  - HTTP 5xx (server errors)
 *  - HTTP 200 error payloads
 *
 * Does NOT retry:
 *  - HTTP 401/403/404
 *  - Non-NVIDIA providers (caller should not call this function)
 */
export async function fetchWithNimDefense(
  fetchFn: () => Promise<Response>,
  modelId: string,
  options: NimRetryOptions = {},
): Promise<Response> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options }
  const sleepFn = opts.sleepFn!
  const maxRetries = Math.max(1, opts.maxRetries!)
  const baseDelay = opts.baseDelay!
  const log = opts.log
  const externalSignal = opts.signal
  const errors: Error[] = []

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Check for user cancellation before each attempt
    if (externalSignal?.aborted) {
      throw externalSignal.reason ?? new DOMException("Aborted", "AbortError")
    }

    try {
      // Per-attempt timeout: compose with any external signal
      // Using AbortSignal.any — existing signals handle the composition
      const response = await fetchFn()

      // Handle HTTP 200 error payloads (before JSON parse)
      if (response.status === 200) {
        const { isError, errorText } = await detectHttp200Error(response.clone())
        if (isError) {
          throw new Error(`NIM HTTP 200 error: ${errorText}`)
        }
      }

      // Only retry 429 and 5xx
      if (response.status === 429 || response.status >= 500) {
        throw new Error(`NIM HTTP ${response.status} error`)
      }

      // Non-OK but non-retryable statuses pass through as-is
      return response
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err))
      errors.push(error)

      const isRetryable =
        // Match by error name
        error.name === "AI_InvalidResponseDataError" ||
        // Match by message pattern (fallback)
        isMessageBasedRetryable(error.message)

      if (isRetryable && attempt < maxRetries - 1) {
        // Full jitter: random(0, min(base * 2^attempt, 8000))
        const cap = Math.min(baseDelay * 2 ** attempt, 8000)
        const delay = Math.random() * cap
        if (log) {
          log(`[NIM] Retry ${attempt + 1}/${maxRetries} after ${Math.round(delay)}ms for ${modelId}: ${error.message}`)
        }
        await sleepFn(delay)
        continue
      }

      // Not retryable or exhausted — throw with summary
      const summary = errors.map((e) => e.message).join("; ")
      const ex = new Error(`NIM retry exhausted for ${modelId}: ${attempt + 1} attempt(s) - ${summary}`)
      ex.name = error.name
      throw ex
    }
  }

  throw new Error("NIM retry exhausted: unexpected exit from retry loop")
}
