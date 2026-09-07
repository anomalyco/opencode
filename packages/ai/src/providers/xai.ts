import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { HttpOptions, ProviderID, type ModelID } from "../schema/index.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponsesChannel } from "../protocols/open-responses-channel.js"
import { XAIResponses } from "../protocols/xai-responses.js"
import { XAIImages } from "../protocols/xai-images.js"
import type { OpenAIOptionsInput } from "./openai-options.js"
import type { ProviderPackage } from "../provider-package.js"

export const id = ProviderID.make("xai")
const baseURL = "https://api.x.ai/v1"

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
  compact: { endpoint: XAIResponses.compact },
  id: "xai-responses",
  provider: id,
  protocol: XAIResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: OpenResponsesChannel.transport({
    id: "xai-responses",
    name: "xAI Responses",
    rotateAfterMs: RESPONSES_WEBSOCKET_ROTATE_AFTER_MS,
  }),
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

const chatRoute = Route.make({
  id: "xai-chat",
  provider: id,
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
  headers: ({ request }): Record<string, string> =>
    request.promptCacheKey ? { "x-grok-conv-id": request.promptCacheKey } : {},
})

export const routes = [responsesRoute, chatRoute]

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "XAI_API_KEY")

const configuredResponsesRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL: endpoint, ...rest } = input
  return responsesRoute.with({
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: auth(input),
  })
}

const configuredChatRoute = (input: LanguageModelOptions) => {
  const { apiKey: _, auth: _auth, baseURL: endpoint, ...rest } = input
  return chatRoute.with({
    ...rest,
    endpoint: { baseURL: endpoint ?? baseURL },
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
      baseURL: input.baseURL ?? baseURL,
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
export const model: ProviderPackage.Definition<
  Settings,
  XAIProviderOptionsInput,
  typeof responsesRoute.compact
>["model"] = (modelID, settings) =>
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
