import { Effect, Schema, Struct } from "effect"
import type { ProviderPackage } from "../provider-package"
import { AnthropicMessages } from "../protocols/anthropic-messages"
import { Auth } from "../route/auth"
import { Route, type RouteDefaultsInput } from "../route/client"
import { Endpoint } from "../route/endpoint"
import { Framing } from "../route/framing"
import { Protocol } from "../route/protocol"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import { GoogleVertexShared } from "./google-vertex-shared"

const VERSION = "vertex-2023-10-16" as const

// models.dev uses this provider id even though the API contract is Anthropic Messages.
export const id = ProviderID.make("google-vertex-anthropic")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.OAuthOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export interface Settings extends ProviderPackage.Settings {
  readonly accessToken?: string
  readonly apiKey?: never
  readonly baseURL?: string
  readonly location?: string
  readonly project?: string
  readonly providerOptions?: ProviderOptions
}

const route = Route.make({
  id: "google-vertex-messages",
  provider: id,
  providerMetadataKey: "anthropic",
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
  }),
  endpoint: Endpoint.path(({ request }) => `/${request.model.id}:streamRawPredict`),
  auth: Auth.none,
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: Config) => {
  if ("apiKey" in input && input.apiKey !== undefined)
    throw new Error("Google Vertex Messages does not support API keys")
  const {
    accessToken: _accessToken,
    auth: _auth,
    baseURL,
    location: inputLocation,
    project: inputProject,
    ...rest
  } = input
  const location = GoogleVertexShared.location(inputLocation, "global")
  const project = GoogleVertexShared.project(inputProject)
  return route.with({
    ...rest,
    endpoint: {
      baseURL:
        baseURL ??
        `https://${GoogleVertexShared.host(location)}/v1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}/publishers/anthropic/models`,
    },
    auth: GoogleVertexShared.oauth(input, project),
  })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.apiKey !== undefined) throw new Error("Google Vertex Messages does not support API keys")
  return configure({
    accessToken: settings.accessToken,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    location: settings.location,
    project: settings.project,
    providerOptions: settings.providerOptions,
  }).model(modelID)
}
