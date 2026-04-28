import { Effect } from "effect"
import type { LLMError, LLMRequest } from "./schema"

/**
 * Per-request transport authentication.
 *
 * Receives the unsigned HTTP request shape (URL, method, body, headers) and
 * returns the headers to actually send.
 *
 * Most adapters use the default `Auth.bearer`, which reads
 * `request.model.apiKey` and sets `Authorization: Bearer ...`. Providers
 * that use a different header pick `Auth.apiKeyHeader(name)` (e.g.
 * Anthropic's `x-api-key`, Gemini's `x-goog-api-key`).
 *
 * Adapters that need per-request signing (AWS SigV4, future Vertex IAM,
 * future Azure AAD) implement `Auth` as a function that hashes the body,
 * mints a signature, and merges signed headers into the result.
 */
export type Auth = (input: AuthInput) => Effect.Effect<Record<string, string>, LLMError>

export interface AuthInput {
  readonly request: LLMRequest
  readonly method: "POST" | "GET"
  readonly url: string
  readonly body: string
  readonly headers: Record<string, string>
}

/**
 * Auth that returns the headers untouched. Use when authentication is
 * handled outside the LLM core (e.g. caller supplied `headers.authorization`
 * directly, or there is genuinely no auth).
 */
export const passthrough: Auth = ({ headers }) => Effect.succeed(headers)

/**
 * Builds an `Auth` that reads `request.model.apiKey` and merges the headers
 * produced by `from(apiKey)` into the outgoing headers. No-op when
 * `model.apiKey` is unset, so callers who pre-set their own auth header keep
 * working. The shared core for `bearer` and `apiKeyHeader`.
 */
const fromApiKey = (from: (apiKey: string) => Record<string, string>): Auth => ({ request, headers }) => {
  const key = request.model.apiKey
  if (!key) return Effect.succeed(headers)
  return Effect.succeed({ ...headers, ...from(key) })
}

/**
 * `Authorization: Bearer <apiKey>` from `request.model.apiKey`. No-op when
 * `model.apiKey` is unset. Used by OpenAI, OpenAI Responses, OpenAI-compatible
 * Chat, and (with Bedrock-specific fallback) Bedrock Converse.
 */
export const bearer: Auth = fromApiKey((key) => ({ authorization: `Bearer ${key}` }))

/**
 * Set a custom header to `request.model.apiKey`. No-op when `model.apiKey`
 * is unset. Used by Anthropic (`x-api-key`) and Gemini (`x-goog-api-key`).
 */
export const apiKeyHeader = (name: string): Auth => fromApiKey((key) => ({ [name]: key }))

export * as Auth from "./auth"
