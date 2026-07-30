import { AuthOptions, type ProviderAuthOption } from "../route/auth-options"
import type { RouteDefaultsInput } from "../route/client"
import { HttpOptions, ProviderID, mergeProviderOptions, type ModelID, type ProviderOptions } from "../schema"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat"
import * as OpenAIResponses from "../protocols/openai-responses"
import { XAIImages } from "../protocols/xai-images"
import type { OpenAIOptionsInput } from "./openai-options"
import type { ProviderPackage } from "../provider-package"

export const id = ProviderID.make("xai")

export type XAIProviderOptionsInput = ProviderOptions & {
  readonly xai?: OpenAIOptionsInput
}

export type ModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: XAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: XAIProviderOptionsInput
}

export type { XAIImageOptions } from "../protocols/xai-images"

export const routes = [OpenAIResponses.route, OpenAICompatibleChat.route]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

const configuredResponsesRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAIResponses.route.with({
    ...rest,
    provider: id,
    providerMetadataKey: "xai",
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
    providerOptions: mergeProviderOptions({ xai: { store: false } }, input.providerOptions),
  })
}

const configuredChatRoute = (input: ModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return OpenAICompatibleChat.route.with({
    ...rest,
    provider: id,
    providerMetadataKey: "xai",
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

export const configure = (input: ModelOptions = {}) => {
  const responsesRoute = configuredResponsesRoute(input)
  const chatRoute = configuredChatRoute(input)
  const responses = (modelID: string | ModelID) => responsesRoute.model<XAIProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) => chatRoute.model<XAIProviderOptionsInput>({ id: modelID })
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
export const model: ProviderPackage.Definition<Settings, XAIProviderOptionsInput>["model"] = (modelID, settings) =>
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
