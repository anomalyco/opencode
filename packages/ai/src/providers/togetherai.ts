import type { ProviderPackage } from "../provider-package.js"
import { OpenAIChat } from "../protocols/openai-chat.js"
import { Provider } from "../provider.js"
import type { OpenAIProviderOptionsInput } from "./openai-options.js"

export type Settings = ProviderPackage.Settings &
  OpenAIProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const togetherai = Provider.make({
  id: "togetherai",
  baseURL: "https://api.together.xyz/v1",
  auth: Provider.apiKey(["TOGETHER_API_KEY", "TOGETHER_AI_API_KEY"]),
  apis: [
    OpenAIChat.api.configure({
      capabilities: { output: { maxTokensField: "max_tokens" }, tools: { strict: false } },
    }),
  ],
})

export const model = Provider.entrypoint<Settings, OpenAIProviderOptionsInput>(togetherai)

export * as TogetherAI from "./togetherai.js"
