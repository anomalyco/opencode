export * as ConfigProviderOptionsV1 from "./provider-options.js"

type Options = Readonly<Record<string, unknown>>

export interface ProviderResult {
  readonly settings: Record<string, unknown>
  readonly headers?: Record<string, string>
  readonly body?: Record<string, unknown>
}

export function provider(options: Options): ProviderResult {
  const headers = options.headers
  const body = options.body
  const settings = Object.fromEntries(Object.entries(options).filter(([key]) => key !== "headers" && key !== "body"))
  const headerOverlay =
    typeof headers === "object" && headers !== null && !Array.isArray(headers)
      ? Object.fromEntries(
          Object.entries(headers).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
        )
      : undefined
  const bodyOverlay = typeof body === "object" && body !== null && !Array.isArray(body) ? { ...body } : undefined
  return {
    settings,
    headers: headerOverlay,
    body: bodyOverlay,
  }
}

export function model(options: Options) {
  return { ...options }
}

// Model options read before the request is built; v1's `@ai-sdk/openai-compatible` sent every other one verbatim
// in the request body.
const COMPATIBLE_KEYS = new Set([
  "apiKey",
  "baseURL",
  "headers",
  "body",
  "extraBody",
  "timeout",
  "chunkTimeout",
  "headerTimeout",
  "disabled",
  "reasoningEffort",
  "textVerbosity",
  "user",
  "strictJsonSchema",
])

// v1 treated these as the model's max output and sent a single max-token field. Left in the body
// they would sit next to the one the request builder derives from the output limit, and strict
// endpoints reject a body carrying both, so they are reported separately instead.
const MAX_TOKENS_KEYS = ["max_tokens", "max_completion_tokens", "maxTokens"]

export const MAX_TOKENS_BODY_KEY = "max_tokens"

export function compatibleModel(options: Options) {
  const maxTokens = MAX_TOKENS_KEYS.map((key) => options[key]).find((value) => typeof value === "number")
  // Anything the model cannot use as a limit keeps v1's behavior and goes out in the body.
  const entries = Object.entries(options).filter(
    ([key, value]) => !(MAX_TOKENS_KEYS.includes(key) && typeof value === "number"),
  )
  const body = Object.fromEntries(entries.filter(([key]) => !COMPATIBLE_KEYS.has(key)))
  return {
    settings: Object.fromEntries(entries.filter(([key]) => COMPATIBLE_KEYS.has(key))),
    body: Object.keys(body).length ? body : undefined,
    maxTokens,
  }
}
