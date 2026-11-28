import type { AnthropicMessages } from "../../protocols/anthropic-messages.js"
import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import type { OpenResponsesProviderOptionsInput } from "../open-responses-options.js"

export type ProviderOptionsInput = OpenResponsesProviderOptionsInput &
  Pick<AnthropicMessages.OptionsInput, "thinking" | "effort">

export type Settings = ProviderPackage.Settings &
  ProviderOptionsInput & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

/** What every Meta API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "meta",
  baseURL: "https://api.meta.ai/v1",
  auth: Provider.apiKey("META_API_KEY"),
} satisfies Omit<Provider.Input<[]>, "apis">
