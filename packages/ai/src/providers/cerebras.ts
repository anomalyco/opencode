import type { ProviderPackage } from "../provider-package.js"
import { OpenAICompatibleChat } from "../protocols/openai-compatible-chat.js"
import { AuthOptions, type ProviderAuthOption } from "../route/auth-options.js"
import type { RouteDefaultsInput } from "../route/client.js"
import { ProviderID, type ModelID } from "../schema/index.js"
import { profiles } from "./openai-compatible-profile.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("cerebras")

export type LanguageModelOptions = Omit<RouteDefaultsInput, "providerOptions"> &
  ProviderAuthOption<"optional"> & {
    readonly baseURL?: string
    readonly providerOptions?: OpenAIProviderOptionsInput
  }

export interface Settings extends ProviderPackage.Settings {
  readonly apiKey?: string
  readonly baseURL?: string
  readonly providerOptions?: OpenAIProviderOptionsInput
}

export const route = OpenAICompatibleChat.route.with({
  id: "cerebras-chat",
  provider: id,
  endpoint: { baseURL: profiles.cerebras.baseURL },
})

export const routes = [route]

export const configure = (input: LanguageModelOptions = {}) => {
  const { apiKey: _apiKey, auth: _auth, baseURL, ...defaults } = input
  const configured = route.with({
    ...defaults,
    endpoint: { baseURL: baseURL ?? profiles.cerebras.baseURL },
    auth: AuthOptions.bearer(input, "CEREBRAS_API_KEY"),
  })
  return {
    id,
    model: (modelID: string | ModelID) =>
      configured.model<OpenAIProviderOptionsInput>({
        id: modelID,
        compatibility: { maxTokensField: "max_tokens", reasoningField: "reasoning", supportsStore: false },
      }),
    configure,
  }
}

export const provider = configure()

export const model: ProviderPackage.Definition<Settings, OpenAIProviderOptionsInput>["model"] = (modelID, settings) =>
  configure({
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    headers: settings.headers === undefined ? undefined : { ...settings.headers },
    http: settings.body === undefined ? undefined : { body: { ...settings.body } },
    providerOptions: settings.providerOptions,
  }).model(modelID)
