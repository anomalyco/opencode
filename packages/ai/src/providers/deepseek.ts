import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const deepseek = Provider.make({
  id: "deepseek",
  baseURL: "https://api.deepseek.com/v1",
  auth: Provider.apiKey("DEEPSEEK_API_KEY"),
  apis: [OpenAIChat.api.configure({ capabilities: { output: { maxTokensField: "max_tokens" } } })],
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(deepseek)

export * as DeepSeek from "./deepseek.js"
