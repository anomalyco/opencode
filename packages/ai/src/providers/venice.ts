import type { ProviderPackage } from "../provider-package.js"
import { VeniceChat } from "../protocols/venice-chat.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"

export const id = ProviderID.make("venice")
export type ChatOptionsInput = VeniceChat.OptionsInput
export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly queryParams?: Readonly<Record<string, string>>
    readonly providerOptions?: ChatOptionsInput
  }
export type Settings = ProviderPackage.Settings &
  ChatOptionsInput & {
    readonly apiKey?: string
    readonly baseURL?: string
    readonly queryParams?: Readonly<Record<string, string>>
  }

const route = Route.make({
  id: "venice-chat",
  provider: id,
  providerMetadataKey: "venice",
  protocol: VeniceChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL: "https://api.venice.ai/api/v1" }),
  framing: OpenAIChat.framing,
})
export const routes = [route]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, queryParams, ...rest } = input
  const chat = (modelID: string | ModelID) =>
    route
      .with({
        ...rest,
        endpoint: { baseURL: baseURL ?? route.endpoint.baseURL, query: queryParams },
        auth: AuthOptions.bearer(input, "VENICE_API_KEY"),
      })
      .model<ChatOptionsInput>({ id: modelID, compatibility: VeniceChat.compatibility })
  return { id, model: chat, chat, configure }
}

export const provider = configure()
export const chat = provider.chat
export const model: ProviderPackage.Definition<Settings, ChatOptionsInput>["model"] = (
  modelID,
  { apiKey, baseURL, queryParams, body, headers, ...providerOptions },
) =>
  configure({
    apiKey,
    baseURL,
    queryParams,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }).model(modelID)

export * as Venice from "./venice.js"
