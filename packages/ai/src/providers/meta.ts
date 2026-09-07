import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { OpenResponses } from "../protocols/open-responses.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import { Route, type RouteDefaultsInput } from "../route/client.js"
import { Endpoint } from "../route/endpoint.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import type { OpenResponsesProviderOptionsInput } from "./open-responses-options.js"

export const id = ProviderID.make("meta")
const baseURL = "https://api.meta.ai/v1"

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenResponsesProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: OpenResponsesProviderOptionsInput
}

const responsesRoute = Route.make({
  id: "meta-responses",
  provider: id,
  providerMetadataKey: "meta",
  protocol: OpenResponses.protocol,
  endpoint: Endpoint.path("/responses", { baseURL }),
  transport: OpenResponses.httpTransport,
  defaults: { providerOptions: { store: false, include: ["reasoning.encrypted_content"] } },
})

const chatRoute = Route.make({
  id: "meta-chat",
  provider: id,
  providerMetadataKey: "meta",
  protocol: OpenAIChat.protocol,
  endpoint: Endpoint.path("/chat/completions", { baseURL }),
  framing: OpenAIChat.framing,
})

export const routes = [responsesRoute, chatRoute]

export const configure = (input: LanguageModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL: endpoint, ...defaults } = input
  const options = {
    ...defaults,
    endpoint: { baseURL: endpoint ?? baseURL },
    auth: AuthOptions.bearer(input, "META_API_KEY"),
  }
  const configuredResponses = responsesRoute.with(options)
  const configuredChat = chatRoute.with(options)
  const responses = (modelID: string | ModelID) =>
    configuredResponses.model<OpenResponsesProviderOptionsInput>({ id: modelID })
  const chat = (modelID: string | ModelID) =>
    configuredChat.model<OpenResponsesProviderOptionsInput>({
      id: modelID,
      compatibility: { maxTokensField: "max_completion_tokens", supportsStore: false },
    })
  return { id, model: responses, responses, chat, configure }
}

export const provider = configure()
export const responses = provider.responses
export const chat = provider.chat

export const model: ProviderPackage.Definition<Settings, OpenResponsesProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).responses(modelID)

export const chatModel: ProviderPackage.Definition<Settings, OpenResponsesProviderOptionsInput>["model"] = (
  modelID,
  settings,
) => fromSettings(settings).chat(modelID)

function fromSettings(settings: Settings) {
  return configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers,
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  })
}

export * as Meta from "./meta.js"
