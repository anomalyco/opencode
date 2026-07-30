import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { HttpOptions, ProviderID, type ModelID } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { XAIImages } from "../protocols/xai-images"
import type { OpenAIProviderOptionsInput } from "./openai-options"
import type { ProviderPackage } from "../provider-package"

export const id = ProviderID.make("xai")

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export type { XAIImageOptions } from "../protocols/xai-images"

export const routes = [OpenAIResponses.route, OpenAICompatibleChat.route]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

const configuredResponsesRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAIResponses.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

const configuredChatRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAICompatibleChat.route.with({
    ...rest,
    provider: id,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const responsesRoute = configuredResponsesRoute(input)
  const chatRoute = configuredChatRoute(input)
  const responses = (modelID: string | ModelID) => responsesRoute.model<OpenAIProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) => chatRoute.model<OpenAIProviderOptionsInput>({ id: modelID })
  const image = (modelID: string | ModelID) =>
    XAIImages.model({
      id: modelID,
      auth: auth(input),
      baseURL: input.baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL,
      headers: input.headers,
      http: input.http === undefined ? undefined : HttpOptions.make(input.http),
    })
  return {
    id,
    model: responses,
    responses,
    chat,
    image,
    configure,
  }
}

export const provider = configure()
export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    limits: settings.limits,
    providerOptions: settings.providerOptions,
  }).model(modelID)
export const responses = provider.responses
export const chat = provider.chat
export const image = provider.image
