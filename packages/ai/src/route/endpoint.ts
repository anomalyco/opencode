import type { LLMRequest } from "../schema/index.js"
import * as ProviderShared from "../protocols/shared.js"

export interface EndpointInput<Body> {
  readonly request: LLMRequest
  readonly body: Body
}

export type EndpointPart<Body> = string | ((input: EndpointInput<Body>) => string)

/**
 * Declarative URL construction for one route.
 *
 * `Endpoint` carries URL construction for one route. Routes with a canonical
 * host put `baseURL` here; provider helpers can override it by configuring the
 * route before selecting a model.
 *
 * `path` may be a string or a function of `EndpointInput`, for routes whose
 * URL embeds the model id, region, or another body field (e.g. Bedrock,
 * Gemini).
 */
export interface Definition<Body> {
  readonly baseURL?: string
  readonly path: EndpointPart<Body>
  readonly query?: Record<string, string>
}

export type EndpointPatch<Body> = Partial<Definition<Body>>

/** Construct an `Endpoint` from a path string or path function. */
export const path = <Body>(
  value: EndpointPart<Body>,
  options: Omit<Definition<Body>, "path"> = {},
): Definition<Body> => ({
  ...options,
  path: value,
})

export const merge = <Body>(base: Definition<Body>, patch: EndpointPatch<Body>): Definition<Body> => ({
  ...base,
  ...patch,
  baseURL: patch.baseURL ?? base.baseURL,
  path: patch.path ?? base.path,
  query: patch.query === undefined ? base.query : { ...base.query, ...patch.query },
})

const renderPart = <Body>(part: EndpointPart<Body>, input: EndpointInput<Body>) =>
  typeof part === "function" ? part(input) : part

export const render = <Body>(endpoint: Definition<Body>, input: EndpointInput<Body>) => {
  const url = new URL(`${ProviderShared.trimBaseUrl(endpoint.baseURL ?? "")}${renderPart(endpoint.path, input)}`)
  for (const [key, value] of Object.entries(endpoint.query ?? {})) url.searchParams.set(key, value)
  return url
}

export * as Endpoint from "./endpoint.js"
