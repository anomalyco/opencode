import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"

export type MessagesOptionsInput = {
  /** M3 defaults to disabled; M2.x always thinks. */
  readonly thinking?: { readonly type: "adaptive" | "disabled" }
  readonly metadata?: AnthropicMessages.OptionsInput["metadata"]
}

export type ChatOptionsInput = {
  /** M3 defaults to adaptive; M2.x always thinks. */
  readonly thinking?: { readonly type: "adaptive" | "disabled" | (string & {}) }
  /** Separates reasoning from text. Defaults to true. */
  readonly reasoningSplit?: boolean
}

export type ResponsesOptionsInput = {
  /** M3 defaults to none. Other supported values enable thinking without changing its depth. */
  readonly reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | (string & {})
}

export type ProviderOptionsInput = MessagesOptionsInput | ChatOptionsInput | ResponsesOptionsInput

export type Settings<Options = MessagesOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    /** Overrides the selected API's base URL, including its version prefix. */
    readonly baseURL?: string
  }

/** What every MiniMax API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "minimax",
  auth: Provider.apiKey("MINIMAX_API_KEY"),
} satisfies Omit<Provider.Input<[]>, "apis">
