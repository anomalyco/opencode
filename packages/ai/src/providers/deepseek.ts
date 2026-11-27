import { Api } from "../api.js"
import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import { ProviderID } from "../schema/index.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export const id = ProviderID.make("deepseek")

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

const chat = OpenAIChat.api.at("https://api.deepseek.com/v1", {
  id: "deepseek-chat",
  capabilities: { output: { maxTokensField: "max_tokens" } },
})

export const provider = Provider.make({ id, auth: Provider.apiKey("DEEPSEEK_API_KEY"), apis: { chat } })

export const route = Api.route(chat, { provider: id })

export const routes = [route]

export const configure = (patch: Provider.Patch = {}) => provider.with(patch)

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(provider)

export * as DeepSeek from "./deepseek.js"
