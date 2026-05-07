import { Effect } from "effect"
import * as ProviderShared from "../protocols/shared"
import type { LLMError, LLMRequest } from "../schema"

export interface EndpointInput<Body> {
  readonly request: LLMRequest
  readonly body: Body
}

export type EndpointPart<Body> = string | ((input: EndpointInput<Body>) => string)

/**
 * Declarative URL construction for one route.
 *
 * `Endpoint` is the deployment-side answer to "where does this request go?".
 * `render(...)` interprets this data after protocol body construction, so
 * dynamic pieces can read the final `LLMRequest` and validated provider body.
 */
export interface Endpoint<Body> {
  readonly baseURL?: EndpointPart<Body>
  readonly path: EndpointPart<Body>
  /** Error message used when neither `model.baseURL` nor `baseURL` is set. */
  readonly required?: string
}

/**
 * Build a URL from the model's `baseURL` (or a default) plus a path. Appends
 * `model.queryParams` so routes that need request-level query params
 * (Azure `api-version`, etc.) get them for free.
 *
 * Both `default` and `path` may be strings or functions of the
 * `EndpointInput`, for routes whose URL embeds the model id, region, or
 * another body field.
 */
export const baseURL = <Body>(input: {
  readonly default?: string | ((input: EndpointInput<Body>) => string)
  readonly path: string | ((input: EndpointInput<Body>) => string)
  readonly required?: string
}): Endpoint<Body> => ({
  baseURL: input.default,
  path: input.path,
  required: input.required,
})

const renderPart = <Body>(part: EndpointPart<Body> | undefined, input: EndpointInput<Body>) =>
  typeof part === "function" ? part(input) : part

export const render = <Body>(endpoint: Endpoint<Body>, input: EndpointInput<Body>) =>
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
