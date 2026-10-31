import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { ZAIChat } from "../protocols/zai-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { ZAI } from "./zai.js"

export const id = ProviderID.make("zai-coding-plan")

export type ChatOptionsInput = ZAIChat.OptionsInput
export type MessagesOptionsInput = ZAI.MessagesOptionsInput
export type ResponsesOptionsInput = ZAI.ResponsesOptionsInput

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

const chatRoute = Route.make({
  id: "zai-coding-chat",
  provider: id,
  providerMetadataKey: "zai",
  protocol: ZAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.z.ai/api/coding/paas/v4" }),
  framing: OpenAIChat.framing,
})
// The Coding Plan shares the pay-as-you-go Messages and Responses endpoints; only Chat has its own base URL.
const messagesRoute = ZAI.messagesRoute.with({ id: "zai-coding-messages", provider: id, providerMetadataKey: "zai" })
const responsesRoute = ZAI.responsesRoute.with({ id: "zai-coding-responses", provider: id, providerMetadataKey: "zai" })

export const routes = [chatRoute, messagesRoute, responsesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...rest } = input
  const defaults = {
    ...rest,
    endpoint: baseURL === undefined ? undefined : { baseURL },
    auth: AuthOptions.bearer(input, "ZAI_API_KEY"),
  }
  const chat = (modelID: string | ModelID) =>
    chatRoute.with(defaults).model<ChatOptionsInput>({ id: modelID, compatibility: ZAIChat.compatibility })
  const messages = (modelID: string | ModelID) =>
    messagesRoute
      .with(defaults)
      .model<MessagesOptionsInput>({ id: modelID, compatibility: { requireSignature: false } })
  const responses = (modelID: string | ModelID) =>
    responsesRoute.with(defaults).model<ResponsesOptionsInput>({ id: modelID })
  return { id, model: chat, chat, messages, responses, configure }
}

export const provider = configure()
export const chat = provider.chat
export const messages = provider.messages
export const responses = provider.responses

export const model: ProviderPackage.Model<Settings, ChatOptionsInput> = (
  modelID,
  { apiKey, baseURL, body, headers, ...providerOptions }: Settings = {},
) =>
  configure({
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model(modelID)

export * as ZAICodingPlan from "./zai-coding-plan.js"
