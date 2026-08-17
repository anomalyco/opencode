import { Route, type RouteRoutedLanguageModelInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import * as OpenAIChat from "./openai-chat.js"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatLanguageModelInput = RouteRoutedLanguageModelInput

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * overrides only the route id so providers can be resolved per-family without
 * colliding with native OpenAI. Provider helpers configure the route endpoint
 * before model selection.
 */
export const route = Route.make({
  id: ADAPTER,
  providerMetadataKey: "openai",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export * as OpenAICompatibleChat from "./openai-compatible-chat.js"
