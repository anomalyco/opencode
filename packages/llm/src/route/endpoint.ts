import type { LLMRequest } from "../schema"
import * as ProviderShared from "../protocols/shared"

export interface EndpointInput<Body> {
  readonly request: LLMRequest
  readonly body: Body
}

export type EndpointPart<Body> = string | ((input: EndpointInput<Body>) => string)

/**
 * Declarative URL construction for one route.
 *
 * `Endpoint` carries only the path. The host always lives on `model.baseURL`,
 * supplied by the provider helper that constructs the model. `render(...)`
 * just appends the path (and any `model.queryParams`) to that host.
 *
 * `path` may be a string or a function of `EndpointInput`, for routes whose
 * URL embeds the model id, region, or another body field (e.g. Bedrock,
 * Gemini).
 */
export interface Endpoint<Body> {
  readonly path: EndpointPart<Body>
}

/** Construct an `Endpoint` from a path string or path function. */
export const path = <Body>(value: EndpointPart<Body>): Endpoint<Body> => ({ path: value })

const renderPart = <Body>(part: EndpointPart<Body>, input: EndpointInput<Body>) =>
  typeof part === "function" ? part(input) : part

export const render = <Body>(endpoint: Endpoint<Body>, input: EndpointInput<Body>) => {
  const url = new URL(
    `${ProviderShared.trimBaseUrl(input.request.model.baseURL)}${renderPart(endpoint.path, input)}`,
  )
  const params = input.request.model.queryParams
  if (params) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  return url
}

export * as Endpoint from "./endpoint"
