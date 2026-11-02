import type { ProviderPackage } from "../provider-package.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("google-vertex")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.OAuthOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: OpenResponsesProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  OpenResponsesProviderOptionsInput & {
    readonly accessToken?: string
    readonly apiKey?: never
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

const route = Route.make({
  id: "google-vertex-responses",
  provider: id,
  providerMetadataKey: "vertex",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path(OpenResponses.PATH),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

export const routes = [route]

const configuredRoute = (input: Config) =>
  GoogleVertexShared.oauthRoute(
    route,
    "Responses",
    input,
    (project, location) =>
      `https://aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/endpoints/openapi`,
  )

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model<OpenResponsesProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Model<Settings, OpenResponsesProviderOptionsInput> = (modelID, settings = {}) =>
  configure(GoogleVertexShared.oauthSettings<OpenResponsesProviderOptionsInput>("Responses", settings)).model(modelID)
