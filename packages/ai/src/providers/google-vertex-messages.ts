import { Effect, Schema, Struct } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { Api } from "../api.js"
import { Capabilities } from "../capabilities.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { Protocol } from "../route/protocol.js"
import { Provider } from "../provider.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

const VERSION = "vertex-2023-10-16" as const

export type Settings = ProviderPackage.Settings &
  AnthropicMessages.ProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

// Vertex takes the model from the URL and the Anthropic version in the body instead.
export const messages = Api.make({
  name: "messages",
  id: "google-vertex-messages",
  protocol: Protocol.make({
    id: AnthropicMessages.protocol.id,
    body: {
      schema: Schema.Struct({
        ...Struct.omit(AnthropicMessages.AnthropicMessagesBody.fields, ["model"]),
        anthropic_version: Schema.Literal(VERSION),
      }),
      from: (request) =>
        AnthropicMessages.protocol.body.from(request).pipe(
          Effect.map((body) => ({
            ...Struct.omit(body, ["model"]),
            anthropic_version: VERSION,
          })),
        ),
    },
    stream: AnthropicMessages.protocol.stream,
    supportsEffortUpdates: AnthropicMessages.protocol.supportsEffortUpdates,
    toolUpdates: AnthropicMessages.protocol.toolUpdates,
  }),
  path: ({ request }) => `/${request.model.id}:streamRawPredict`,
  transport: AnthropicMessages.transport<
    Omit<AnthropicMessages.AnthropicMessagesBody, "model"> & { readonly anthropic_version: typeof VERSION }
  >(),
  headers: () => ({ "anthropic-version": "2023-06-01" }),
  capabilities: Capabilities.defaults<Capabilities.Messages>({ cache: { markers: true } }),
}).configure({ metadataKey: "vertex" })

export const googleVertexMessages = Provider.make({
  ...GoogleVertexShared.shared,
  apis: [messages],
  settings: GoogleVertexShared.oauthSettings(
    "Messages",
    (project, location) =>
      `https://${GoogleVertexShared.host(location)}/v1/projects/${project}/locations/${location}/publishers/anthropic/models`,
  ),
})

export const model = Provider.entrypoint<Settings, AnthropicMessages.ProviderOptionsInput>(googleVertexMessages)
