import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const cerebras = Provider.make({
  id: "cerebras",
  baseURL: "https://api.cerebras.ai/v1",
  auth: Provider.apiKey("CEREBRAS_API_KEY"),
  apis: [
    OpenAIChat.api.configure({
      capabilities: {
        output: { maxTokensField: "max_tokens" },
        reasoning: { field: "reasoning" },
        cache: { promptCacheKey: true },
      },
    }),
  ],
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(cerebras)

export * as Cerebras from "./cerebras.js"
