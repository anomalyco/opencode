import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<RouteRoutedModelInput, "baseURL"> & {
  readonly baseURL: string
}

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * overrides only the route id so providers can be resolved per-family without
 * colliding with native OpenAI. The model carries the host on `baseURL`,
 * supplied by whichever profile/provider helper builds it.
 */
export const route = Route.make({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export const model = Route.model<OpenAICompatibleChatModelInput>(route)

export * as OpenAICompatibleChat from "./openai-compatible-chat"
