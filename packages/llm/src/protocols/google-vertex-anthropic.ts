import { Effect, Schema, Struct } from "effect"
import { AnthropicMessages } from "./anthropic-messages"
import { Auth } from "../route/auth"
import { Route } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"

const VERSION = "vertex-2023-10-16" as const

export const GoogleVertexAnthropicBody = Schema.Struct({
  ...Struct.omit(AnthropicMessages.AnthropicMessagesBody.fields, ["model"]),
  anthropic_version: Schema.Literal(VERSION),
})
export type GoogleVertexAnthropicBody = Schema.Schema.Type<typeof GoogleVertexAnthropicBody>

export const protocol = Protocol.make({
  id: "google-vertex-anthropic",
  body: {
    schema: GoogleVertexAnthropicBody,
    from: (request) =>
      AnthropicMessages.protocol.body.from(request).pipe(
        Effect.map((body) => ({
          ...Struct.omit(body, ["model"]),
          anthropic_version: VERSION,
        })),
      ),
  },
  stream: AnthropicMessages.protocol.stream,
})

export const route = Route.make({
  id: "google-vertex-anthropic",
  provider: "google-vertex-anthropic",
  providerMetadataKey: "anthropic",
  protocol,
  endpoint: Endpoint.path(({ request }) => `/${request.model.id}:streamRawPredict`),
  auth: Auth.none,
  framing: Framing.sse,
})

export * as GoogleVertexAnthropic from "./google-vertex-anthropic"
