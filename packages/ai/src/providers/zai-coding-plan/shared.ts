import type { ProviderPackage } from "../../provider-package.js"
import type { ZAIChat } from "../../protocols/zai-chat.js"
import type { ZAIMessages } from "../../protocols/zai-messages.js"
import { Provider } from "../../provider.js"

export type ChatOptionsInput = ZAIChat.OptionsInput
export type MessagesOptionsInput = ZAIMessages.OptionsInput
export type ResponsesOptionsInput = { readonly reasoningEffort?: ZAIChat.ReasoningEffort }

export type Settings<Options = ChatOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    /** Overrides the selected API's complete base URL. */
    readonly baseURL?: string
  }

/** What every Z.AI Coding Plan API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "zai-coding-plan",
  auth: Provider.apiKey("ZAI_API_KEY"),
} satisfies Omit<Provider.Input<[]>, "apis">
