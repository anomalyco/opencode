import type { ProviderPackage } from "../provider-package"
import { OpenAICompatibleResponses } from "../protocols/openai-compatible-responses"
import type { RouteDefaultsInput } from "../route/client"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema"
import { GoogleVertexShared } from "./google-vertex-shared"

export const id = ProviderID.make("google-vertex")

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

const route = OpenAICompatibleResponses.route.with({
  id: "google-vertex-responses",
  provider: id,
})

export const routes = [route]

const configuredRoute = (input: Config) => {
  if ("apiKey" in input && input.apiKey !== undefined)
    throw new Error("Google Vertex Responses does not support API keys")
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
        `https://aiplatform.googleapis.com/v1/projects/${GoogleVertexShared.requireProject(project)}/locations/${location}/endpoints/openapi`,
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
  if (settings.apiKey !== undefined) throw new Error("Google Vertex Responses does not support API keys")
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
