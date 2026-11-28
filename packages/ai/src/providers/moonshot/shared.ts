import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"

export type ReasoningEffort = "low" | "high" | "max" | (string & {})

export type ChatOptionsInput = {
  /** K3 always reasons; omitted effort uses the model's default. */
  readonly reasoningEffort?: ReasoningEffort
  /** K2.6 supports disabling thinking; K2.7 Code always thinks and preserves reasoning. */
  readonly thinking?: {
    readonly type: "enabled" | "disabled" | (string & {})
    readonly keep?: "all" | (string & {}) | null
  }
}

export type MessagesOptionsInput = {
  readonly effort?: ReasoningEffort
  readonly metadata?: AnthropicMessages.OptionsInput["metadata"]
}

export type ResponsesOptionsInput = {
  readonly reasoningEffort?: ReasoningEffort
  readonly safetyIdentifier?: string
}

export type Settings<Options = ChatOptionsInput> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    /** Overrides the selected API's base URL, including its version prefix. */
    readonly baseURL?: string
  }

/** What every Moonshot API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "moonshotai",
  auth: Provider.apiKey(["MOONSHOT_API_KEY", "MOONSHOTAI_API_KEY"]),
} satisfies Omit<Provider.Input<[]>, "apis">
