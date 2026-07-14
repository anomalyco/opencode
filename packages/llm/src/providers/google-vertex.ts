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

export interface Settings extends ProviderPackage.Settings {
  readonly accessToken?: string
  readonly apiKey?: string
  readonly baseURL?: string
  readonly location?: string
  readonly project?: string
  readonly providerOptions?: ProviderOptions
}

export const routes = [GoogleVertexGemini.route]

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
  const location = GoogleVertexShared.location(inputLocation, "us-central1")
  const project = GoogleVertexShared.project(inputProject)
  const endpoint =
    baseURL ??
    (apiKey
      ? "https://aiplatform.googleapis.com/v1/publishers/google"
      : `https://${GoogleVertexShared.host(location)}/v1beta1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}/publishers/google`)
  return GoogleVertexGemini.route.with({
    ...rest,
    endpoint: { baseURL: endpoint },
    auth: apiKey === undefined ? GoogleVertexShared.oauth(input) : Auth.header("x-goog-api-key", apiKey),
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
export const model: ProviderPackage.Definition<Settings>["model"] = (modelID, settings) =>
  configure({
    accessToken: settings.accessToken,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    location: settings.location,
    project: settings.project,
    providerOptions: settings.providerOptions,
  }).model(modelID)
