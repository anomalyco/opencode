import { Effect, Schema, Struct } from "effect"
import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import { Auth } from "../route/auth.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Protocol } from "../route/protocol.js"
import { HttpTransport } from "../route/transport/index.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
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

const configuredRoute = (input: Config) => {
  if ("apiKey" in input && input.apiKey !== undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Google Vertex Mistral does not support API keys" })
  const {
    accessToken: _accessToken,
    auth: _auth,
    baseURL,
    location: inputLocation,
    project: inputProject,
    ...rest
  } = input
  const location = GoogleVertexShared.location(inputLocation)
  const project = GoogleVertexShared.project(inputProject)
  return route.with({
    ...rest,
    endpoint: {
      baseURL:
        baseURL ??
        `https://${GoogleVertexShared.host(location)}/v1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}/publishers/mistralai/models`,
    },
    auth: GoogleVertexShared.oauth(input, project),
  })
}

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

export const model: ProviderPackage.Definition<Settings, MistralChat.ProviderOptionsInput>["model"] = (
  modelID,
  { accessToken, apiKey, baseURL, body, headers, location, project, ...providerOptions },
) => {
  if (apiKey !== undefined)
    throw new ProviderConfigurationError({ provider: id, message: "Google Vertex Mistral does not support API keys" })
  return configure({
    accessToken,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    location,
    project,
    providerOptions,
  }).model(modelID)
}
