import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { OpenResponses } from "./open-responses"

const ADAPTER = "openai-compatible-responses"

export type OpenAICompatibleResponsesModelInput = RouteRoutedModelInput

/**
 * Deployment adapter for providers that expose an Open Responses-compatible
 * `/responses` endpoint. Provider helpers configure identity, endpoint, and
 * auth while the semantic protocol remains provider-neutral.
 */
export const route = Route.make({
  id: ADAPTER,
  providerMetadataKey: "openresponses",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path(OpenResponses.PATH),
  transport: OpenResponses.httpTransport,
})

export * as OpenAICompatibleResponses from "./openai-compatible-responses"
