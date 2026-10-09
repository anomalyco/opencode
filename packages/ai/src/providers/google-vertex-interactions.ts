import type { ProviderPackage } from "../provider-package.js"
import { GoogleInteractions } from "../protocols/google-interactions.js"
import { Auth } from "../route/auth.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { ProviderConfigurationError, ProviderID, type ModelID } from "../schema/index.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"

export type GoogleInteractionsOptionsInput = GoogleInteractions.OptionsInput

export const id = ProviderID.make("google-vertex")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.ApiKeyOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: GoogleInteractions.ProviderOptionsInput
  }

export type Settings = ProviderPackage.Settings &
  GoogleInteractions.ProviderOptionsInput &
  (
    | { readonly accessToken?: string; readonly apiKey?: never }
    | { readonly accessToken?: never; readonly apiKey?: string }
  ) & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

const route = Route.make({
  id: "google-vertex-interactions",
  provider: id,
  providerMetadataKey: "vertex",
  protocol: GoogleInteractions.protocol,
  endpoint: Endpoint.path("/interactions", { query: { alt: "sse" } }),
  auth: Auth.none,
  headers: ({ request }): Record<string, string> => {
    const serviceTier = request.providerOptions?.serviceTier
    return typeof serviceTier === "string" ? { "x-vertex-ai-llm-shared-request-type": serviceTier } : {}
  },
  framing: Framing.sse,
})

export const routes = [route]

const configuredRoute = (input: Config) => {
  const {
    accessToken: _accessToken,
    apiKey: _apiKey,
    auth: _auth,
    baseURL,
    location: inputLocation,
    project: inputProject,
    ...rest
  } = input
  const apiKey = GoogleVertexShared.apiKey(input)
  const location = GoogleVertexShared.location(inputLocation, "global")
  const project = GoogleVertexShared.project(inputProject)
  return route.with({
    ...rest,
    endpoint: {
      baseURL:
        baseURL ??
        `https://${GoogleVertexShared.host(location)}/v1beta1/${apiKey === undefined ? `projects/${GoogleVertexShared.requireProject(project)}/` : ""}locations/${location}`,
    },
    auth: apiKey === undefined ? GoogleVertexShared.oauth(input, project) : Auth.header("x-goog-api-key", apiKey),
  })
}

export const configure = (input: Config = {}) => {
  const route = configuredRoute(input)
  return {
    id,
    model: (modelID: string | ModelID) => route.model<GoogleInteractions.ProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings, GoogleInteractions.ProviderOptionsInput>["model"] = (
  modelID,
  { accessToken, apiKey, baseURL, body, headers, location, project, ...providerOptions },
) => {
  if (apiKey !== undefined && accessToken !== undefined)
    throw new ProviderConfigurationError({
      provider: id,
      message: "Google Vertex apiKey cannot be combined with accessToken or auth",
    })
  return configure({
    ...(apiKey === undefined ? { accessToken } : { apiKey }),
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    location,
    project,
    providerOptions,
  }).model(modelID)
}
