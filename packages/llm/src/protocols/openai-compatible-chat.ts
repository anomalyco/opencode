import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { capabilities } from "../llm"
import * as OpenAIChat from "./openai-chat"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = Omit<RouteRoutedModelInput, "baseURL"> & {
  readonly baseURL: string
}

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * only overrides:
 *
 * - the route id (`openai-compatible-chat`) so providers can be resolved
 *   per-family without colliding with native OpenAI;
 * - the endpoint, which requires `model.baseURL` (no provider default).
 */
export const route = Route.make({
  id: ADAPTER,
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.baseURL({
    path: "/chat/completions",
    required: "OpenAI-compatible Chat requires a baseURL",
  }),
  framing: Framing.sse,
})

export const model = Route.model<OpenAICompatibleChatModelInput>(route, {
  capabilities: capabilities({ tools: { calls: true, streamingInput: true } }),
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
