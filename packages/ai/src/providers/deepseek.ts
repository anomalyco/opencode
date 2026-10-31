import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("deepseek")
const baseURL = "https://api.deepseek.com/v1"
const messagesBaseURL = "https://api.deepseek.com/anthropic/v1"

export type Config = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput | AnthropicMessages.ProviderOptionsInput
  }

export type Settings<Options = OpenAIProviderOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const route = Route.make({
  id: "deepseek-chat",
  provider: id,
  providerMetadataKey: "deepseek",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

const messagesRoute = AnthropicMessages.route.with({
  id: "deepseek-messages",
  provider: id,
  endpoint: { baseURL: messagesBaseURL },
})

export const routes = [route, messagesRoute]

export const configure = (input: Config = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const auth = AuthOptions.bearer(input, "DEEPSEEK_API_KEY")
  const configured = route.with({ ...defaults, endpoint: { baseURL: endpoint ?? baseURL }, auth })
  const configuredMessages = messagesRoute.with({
    ...defaults,
    endpoint: { baseURL: endpoint ?? messagesBaseURL },
    auth,
  })
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({
        id: modelID,
        compatibility: { maxTokensField: "max_tokens" },
      }),
    messages: (modelID: string | ModelID) =>
      configuredMessages.model<AnthropicMessages.ProviderOptionsInput>({
        id: modelID,
        compatibility: { requireSignature: false },
      }),
    configure,
  }
}

export const provider = configure()
export const messages = provider.messages

export const model: ProviderPackage.Model<Settings, OpenAIProviderOptionsInput> = (modelID, settings) =>
  configure(config(settings)).model(modelID)
export const messagesModel: ProviderPackage.Model<
  Settings<AnthropicMessages.ProviderOptionsInput>,
  AnthropicMessages.ProviderOptionsInput
> = (modelID, settings) => configure(config(settings)).messages(modelID)

function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}

export * as DeepSeek from "./deepseek.js"
