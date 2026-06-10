import { Effect } from "effect"
import { Route, type RouteRoutedModelInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import type { LLMRequest } from "../schema"
import * as OpenAIChat from "./openai-chat"
import { isRecord } from "./shared"

const ADAPTER = "openai-compatible-chat"

export type OpenAICompatibleChatModelInput = RouteRoutedModelInput

const includeUsage = (request: LLMRequest) => {
  const provider = String(request.model.provider).split(".")[0]
  const providerOptions = request.providerOptions
  const options =
    providerOptions?.openaiCompatible ??
    providerOptions?.["openai-compatible"] ??
    (provider ? providerOptions?.[provider] : undefined)
  return !isRecord(options) || options.includeUsage !== false
}

export const protocol = Protocol.make({
  ...OpenAIChat.protocol,
  body: {
    schema: OpenAIChat.protocol.body.schema,
    from: (request) =>
      OpenAIChat.protocol.body.from(request).pipe(
        Effect.map((body) => {
          if (includeUsage(request)) return body
          const withoutStreamOptions = { ...body }
          delete withoutStreamOptions.stream_options
          return withoutStreamOptions
        }),
      ),
  },
})

/**
 * Route for non-OpenAI providers that expose an OpenAI Chat-compatible
 * `/chat/completions` endpoint. Reuses `OpenAIChat.protocol` end-to-end and
 * overrides only the route id so providers can be resolved per-family without
 * colliding with native OpenAI. Provider helpers configure the route endpoint
 * before model selection.
 */
export const route = Route.make({
  id: ADAPTER,
  protocol,
  endpoint: Endpoint.path("/chat/completions"),
  framing: Framing.sse,
})

export * as OpenAICompatibleChat from "./openai-compatible-chat"
