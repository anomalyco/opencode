import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { ZAIChat } from "../protocols/zai-chat.js"
import { ZAIImages } from "../protocols/zai-images.js"
import { ZAIMessages } from "../protocols/zai-messages.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { Framing } from "../route/framing.js"
import { MediaRoute } from "../route/media.js"
import { ProviderID, type ModelID, type ProviderOptions } from "../schema/index.js"

export const id = ProviderID.make("zai")

export type ChatOptionsInput = ZAIChat.OptionsInput
export type MessagesOptionsInput = ZAIMessages.OptionsInput
export type ResponsesOptionsInput = { readonly reasoningEffort?: ZAIChat.ReasoningEffort }

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    /** Overrides the selected API's complete base URL. */
    readonly baseURL?: string
    readonly providerOptions?: ChatOptionsInput | MessagesOptionsInput | ResponsesOptionsInput
  }

export type Settings<Options = ChatOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export type { ZAIImageOptions } from "../protocols/zai-images.js"

const auth = (options: ProviderAuthOption<"optional">) => AuthOptions.bearer(options, "ZAI_API_KEY")

const chatRoute = Route.make({
  id: "zai-chat",
  provider: id,
  providerMetadataKey: "zai",
  protocol: ZAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.z.ai/api/paas/v4" }),
  framing: OpenAIChat.framing,
})

export const messagesRoute = Route.make({
  id: "zai-messages",
  provider: id,
  providerMetadataKey: "zai",
  protocol: ZAIMessages.protocol,
  endpoint: Endpoint.path("/messages", { baseURL: "https://api.z.ai/api/anthropic/v1" }),
  framing: AnthropicMessages.framing,
  headers: () => ({ "anthropic-version": "2023-06-01" }),
})
export const responsesRoute = Route.make({
  id: "zai-responses",
  provider: id,
  providerMetadataKey: "zai",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL: "https://api.z.ai/api/v1" }),
  framing: Framing.sse,
})

export const routes = [chatRoute, messagesRoute, responsesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...rest } = input
  const defaults = {
    ...rest,
    endpoint: baseURL === undefined ? undefined : { baseURL },
    auth: auth(input),
  }
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(defaults).model<ChatOptionsInput>({ id: modelID, compatibility: ZAIChat.compatibility })
  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with(defaults)
      .model<MessagesOptionsInput>({ id: modelID, compatibility: { requireSignature: false } })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(defaults).model<ResponsesOptionsInput>({ id: modelID })
  const media = MediaRoute.deployment(input, auth(input))
  const image = (modelID: string | ModelID, providerOptions?: ProviderOptions) =>
    ZAIImages.model({ ...media, id: modelID, providerOptions })

  return {
    id,
    model: chat,
    chat,
    messages,
    responses,
    image,
    configure,
  }
}

export const provider = configure()
export const image = provider.image
export const chat = provider.chat
export const messages = provider.messages
export const responses = provider.responses

export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const messagesModel: ProviderPackage.Model<Settings<MessagesOptionsInput>, MessagesOptionsInput> = (
  modelID,
  settings,
) => configure(config(settings)).messages(modelID)
export const responsesModel: ProviderPackage.Model<Settings<ResponsesOptionsInput>, ResponsesOptionsInput> = (
  modelID,
  settings,
) => configure(config(settings)).responses(modelID)
export const imageModel = (modelID: string, settings?: Settings) => {
  const input = config(settings)
  return configure(input).image(modelID, input.providerOptions)
}

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<object> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as ZAI from "./zai.js"
