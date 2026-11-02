import { Effect, Schema, Struct } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import { Auth } from "../route/auth.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { HttpTransport } from "../route/transport/index.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export const id = ProviderID.make("google-vertex")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.OAuthOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: MistralChat.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  MistralChat.ProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

type Body = Omit<MistralChat.MistralBody, "prompt_cache_key">

// Mistral on Vertex takes the Mistral chat body, model included, through the publisher's streamRawPredict method.
// Vertex validates the body strictly and rejects prompt_cache_key, which Mistral's own API accepts.
const route = Route.make({
  id: "google-vertex-mistral",
  provider: id,
  providerMetadataKey: "vertex",
  protocol: Protocol.make({
    id: MistralChat.protocol.id,
    body: {
      schema: Schema.Struct(Struct.omit(MistralChat.MistralBody.fields, ["prompt_cache_key"])),
      from: (request) =>
        MistralChat.protocol.body.from(request).pipe(Effect.map((body) => Struct.omit(body, ["prompt_cache_key"]))),
    },
    stream: MistralChat.protocol.stream,
  }),
  endpoint: Endpoint.path(({ request }) => `/${request.model.id}:streamRawPredict`),
  auth: Auth.none,
  transport: HttpTransport.sseJson.with<Body>().with({ framing: MistralChat.framing }),
})

export const routes = [route]

const configuredRoute = (input: Config) =>
  GoogleVertexShared.oauthRoute(
    route,
    "Mistral",
    input,
    (project, location) =>
      `https://${GoogleVertexShared.host(location)}/v1/projects/${project}/locations/${location}/publishers/mistralai/models`,
  )

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model<MistralChat.ProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Model<Settings, MistralChat.ProviderOptionsInput> = (modelID, settings = {}) =>
  configure(GoogleVertexShared.oauthSettings<MistralChat.ProviderOptionsInput>("Mistral", settings)).model(modelID)
