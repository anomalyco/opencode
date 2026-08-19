import { ProviderPackage } from "../provider-package.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { GoogleVertexShared } from "./google-vertex-shared.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("google-vertex")

export type Config = RouteDefaultsInput &
  GoogleVertexShared.OAuthOptions & {
    readonly baseURL?: string
    readonly location?: string
    readonly project?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly accessToken?: string
  readonly apiKey?: never
  readonly baseURL?: string
  readonly location?: string
  readonly project?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

const route = OpenAICompatibleChat.route.with({
  id: "google-vertex-chat",
  provider: id,
})

export const routes = [route]

const configuredRoute = (input: Config) => {
  if ("apiKey" in input && input.apiKey !== undefined) throw new Error("Google Vertex Chat does not support API keys")
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
    model: (modelID: string | ModelID) => route.model<OpenAIProviderOptionsInput>({ id: modelID }),
    configure,
  }
}

export const provider = {
  id,
  configure,
}

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (input) => {
  if (input.credential?.type === "key" || (!input.credential && input.settings.apiKey !== undefined))
    throw new Error("Google Vertex Chat does not support API keys")
  return configure({
    ...ProviderPackage.routeDefaults(input.defaults),
    accessToken: input.credential?.type === "oauth" ? input.credential.accessToken : input.settings.accessToken,
    baseURL: input.settings.baseURL,
    location: input.settings.location,
    project: input.settings.project,
    providerOptions: input.settings.providerOptions,
  }).model(input.id)
}
