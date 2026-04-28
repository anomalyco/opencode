import { Effect } from "effect"
import type { LLMError, LLMRequest } from "./schema"

/**
 * Per-request transport authentication.
 *
 * Receives the unsigned HTTP request shape (URL, method, body, headers) and
 * returns the headers to actually send.
 *
 * Most adapters use `Auth.passthrough`: their auth header
 * (`Authorization: Bearer ...`, `x-api-key`, `x-goog-api-key`) is already
 * baked into `model.headers` by the provider's `model()` constructor, and
 * `Auth` has nothing to do per request.
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
 * Auth that returns the headers untouched. Default for providers whose auth
 * header is statically baked into `model.headers`.
 */
export const passthrough: Auth = ({ headers }) => Effect.succeed(headers)

export * as Auth from "./auth"
