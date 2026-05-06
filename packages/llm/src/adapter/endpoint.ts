import { Effect } from "effect"
import * as ProviderShared from "../protocols/shared"
import type { LLMError, LLMRequest } from "../schema"

export interface EndpointInput<Payload> {
  readonly request: LLMRequest
  readonly payload: Payload
}

export type EndpointPart<Payload> = string | ((input: EndpointInput<Payload>) => string)

/**
 * Declarative URL construction for one adapter.
 *
 * `Endpoint` is the deployment-side answer to "where does this request go?".
 * `render(...)` interprets this data after protocol lowering, so dynamic pieces
 * can read the final `LLMRequest` and validated provider payload.
 */
export interface Endpoint<Payload> {
  readonly baseURL?: EndpointPart<Payload>
  readonly path: EndpointPart<Payload>
  /** Error message used when neither `model.baseURL` nor `baseURL` is set. */
  readonly required?: string
}

/**
 * Build a URL from the model's `baseURL` (or a default) plus a path. Appends
 * `model.queryParams` so adapters that need request-level query params
 * (Azure `api-version`, etc.) get them for free.
 *
 * Both `default` and `path` may be strings or functions of the
 * `EndpointInput`, for adapters whose URL embeds the model id, region, or
 * another payload field.
 */
export const baseURL = <Payload>(input: {
  readonly default?: string | ((input: EndpointInput<Payload>) => string)
  readonly path: string | ((input: EndpointInput<Payload>) => string)
  readonly required?: string
}): Endpoint<Payload> => ({
  baseURL: input.default,
  path: input.path,
  required: input.required,
})

const renderPart = <Payload>(part: EndpointPart<Payload> | undefined, input: EndpointInput<Payload>) =>
  typeof part === "function" ? part(input) : part

export const render = <Payload>(endpoint: Endpoint<Payload>, input: EndpointInput<Payload>) =>
  Effect.gen(function* () {
    const base = input.request.model.baseURL ?? renderPart(endpoint.baseURL, input)
    if (!base) return yield* ProviderShared.invalidRequest(endpoint.required ?? "Missing baseURL")
    const path = renderPart(endpoint.path, input)
    const url = new URL(`${ProviderShared.trimBaseUrl(base)}${path}`)
    const params = input.request.model.queryParams
    if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    return url
  })

export * as Endpoint from "./endpoint"
