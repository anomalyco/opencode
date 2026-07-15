import type { ProviderPackage } from "../provider-package"
import { GoogleVertexGemini } from "../protocols/google-vertex-gemini"
import { Auth } from "../route/auth"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import { GoogleVertexShared } from "./google-vertex-shared"

export const id = ProviderID.make("google-vertex")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.ApiKeyOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
  }

export type Settings = ProviderPackage.Settings &
  (
    | { readonly accessToken?: string; readonly apiKey?: never }
    | { readonly accessToken?: never; readonly apiKey?: string }
  ) & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: ProviderOptions
  }

export const routes = [GoogleVertexGemini.route]

const configuredRoute = (input: Config, modelID: string | ModelID) => {
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
  const endpointModel = String(modelID).startsWith("endpoints/")
  if (apiKey !== undefined && endpointModel)
    throw new Error("Google Vertex tuned models do not support Express Mode API keys")
  const location = GoogleVertexShared.location(inputLocation, "us-central1")
  const project = GoogleVertexShared.project(inputProject)
  const endpoint =
    baseURL ??
    (apiKey
      ? "https://aiplatform.googleapis.com/v1/publishers/google"
      : `https://${GoogleVertexShared.host(location)}/v1beta1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}${endpointModel ? "" : "/publishers/google"}`)
  return GoogleVertexGemini.route.with({
    ...rest,
    endpoint: { baseURL: endpoint },
    auth: apiKey === undefined ? GoogleVertexShared.oauth(input, project) : Auth.header("x-goog-api-key", apiKey),
  })
}

export const configure = (input: Config = {}) => {
  return {
    id,
    model: (modelID: string | ModelID) => configuredRoute(input, modelID).model({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) => {
  if (settings.apiKey !== undefined && settings.accessToken !== undefined)
    throw new Error("Google Vertex apiKey cannot be combined with accessToken or auth")
  return configure({
    ...(settings.apiKey === undefined ? { accessToken: settings.accessToken } : { apiKey: settings.apiKey }),
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    location: settings.location,
    project: settings.project,
    providerOptions: settings.providerOptions,
  }).model(modelID)
}
