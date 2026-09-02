import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput, type CompactOperation } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import * as OpenAICompatibleProfiles from "./openai-compatible-profile.js"
import * as OpenAICompatibleChat from "../protocols/openai-compatible-chat.js"
import * as OpenAIChat from "../protocols/openai-chat.js"
import { OpenResponsesChannel } from "../protocols/open-responses-channel.js"
import { XAIResponses } from "../protocols/xai-responses.js"
import { XAIImages } from "../protocols/xai-images.js"
import type { OpenAIOptionsInput } from "./openai-options.js"
import type { ProviderPackage } from "../provider-package.js"

export const id = ProviderID.make("xai")

export type XAIProviderOptionsInput = OpenAIOptionsInput & { readonly contextManagement?: never }

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: XAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: XAIProviderOptionsInput
}

export type { XAIImageOptions } from "../protocols/xai-images.js"

const RESPONSES_WEBSOCKET_ROTATE_AFTER_MS = 24 * 60 * 1000

const responsesRoute = Route.make({
  compact: XAIResponses.compact,
  id: "openai-responses",
  provider: id,
  providerMetadataKey: "xai",
  protocol: XAIResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL: OpenAICompatibleProfiles.profiles.xai.baseURL }),
  transport: OpenResponsesChannel.transport({
    id: "openai-responses",
    name: "xAI Responses",
    rotateAfterMs: RESPONSES_WEBSOCKET_ROTATE_AFTER_MS,
  }),
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

const chatRoute = Route.make({
  id: "openai-compatible-chat",
  provider: id,
  providerMetadataKey: "xai",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: OpenAICompatibleProfiles.profiles.xai.baseURL }),
  transport: OpenAICompatibleChat.route.transport,
  headers: ({ request }): Record<string, string> =>
    request.promptCacheKey ? { "x-grok-conv-id": request.promptCacheKey } : {},
})

export const routes = [responsesRoute, chatRoute]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

const configuredResponsesRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return responsesRoute.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

const configuredChatRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL, ...rest } = input
  return chatRoute.with({
    ...rest,
    endpoint: { baseURL: baseURL ?? OpenAICompatibleProfiles.profiles.xai.baseURL },
    auth: auth(input),
  })
}

export const configure = (input: LanguageModelOptions = {}) => {
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
export const model: ProviderPackage.Definition<Settings, XAIProviderOptionsInput, CompactOperation>["model"] = (
  modelID,
  settings,
) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).model(modelID)
export const responses = provider.responses
export const chat = provider.chat
export const image = provider.image
