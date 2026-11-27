import { Effect, Struct } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import { Provider } from "../provider.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export type Settings = ProviderPackage.Settings &
  MistralChat.ProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

// Mistral on Vertex takes the Mistral chat body, model included, through the publisher's streamRawPredict method.
// Vertex validates the body strictly and rejects prompt_cache_key, which Mistral's own API accepts.
export const mistral = MistralChat.api
  .extend({
    id: "google-vertex-mistral",
    body: (request, base) => base(request).pipe(Effect.map((body) => Struct.omit(body, ["prompt_cache_key"]))),
    path: ({ request }) => `/${request.model.id}:streamRawPredict`,
  })
  .configure({ metadataKey: "vertex" })

export const googleVertexMistral = Provider.make({
  ...GoogleVertexShared.shared,
  apis: [mistral],
  settings: GoogleVertexShared.oauthSettings(
    "Mistral",
    (project, location) =>
      `https://${GoogleVertexShared.host(location)}/v1/projects/${project}/locations/${location}/publishers/mistralai/models`,
  ),
})

export const model = Provider.entrypoint<Settings, MistralChat.ProviderOptionsInput>(googleVertexMistral)
