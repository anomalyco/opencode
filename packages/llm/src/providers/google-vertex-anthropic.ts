import type { ProviderPackage } from "../provider-package"
import { GoogleVertexAnthropic } from "../protocols/google-vertex-anthropic"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import { GoogleVertexShared } from "./google-vertex-shared"

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

export const routes = [GoogleVertexAnthropic.route]

const configuredRoute = (input: Config) => {
  if ("apiKey" in input && input.apiKey !== undefined)
    throw new Error("Google Vertex Anthropic does not support API keys")
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
  return GoogleVertexAnthropic.route.with({
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
  if (settings.apiKey !== undefined) throw new Error("Google Vertex Anthropic does not support API keys")
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
