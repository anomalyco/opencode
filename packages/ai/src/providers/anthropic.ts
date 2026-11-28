import type { ProviderPackage } from "../provider-package.js"
import { AnthropicMessages } from "../protocols/anthropic-messages.js"
import { Provider } from "../provider.js"
import { AnthropicCompatible } from "./anthropic-compatible.js"

export type AnthropicOptionsInput = AnthropicMessages.OptionsInput
export type AnthropicProviderOptionsInput = AnthropicMessages.ProviderOptionsInput
export type AnthropicThinkingInput = AnthropicMessages.ThinkingInput

export type Settings = ProviderPackage.Settings &
  AnthropicMessages.ProviderOptionsInput &
  (
    | { readonly apiKey?: string | false; readonly authToken?: never }
    | { readonly apiKey?: never; readonly authToken?: string }
  ) & {
    readonly baseURL?: string
  }

export const anthropic = Provider.make({
  id: "anthropic",
  baseURL: "https://api.anthropic.com/v1",
  auth: AnthropicCompatible.shared.auth(["ANTHROPIC_API_KEY"]),
  apis: [AnthropicCompatible.shared.api],
  settings: AnthropicCompatible.shared.settings,
})

const entrypoint = Provider.entrypoint<Settings, AnthropicMessages.ProviderOptionsInput, undefined>(anthropic)

export const model: ProviderPackage.Model<Settings, AnthropicMessages.ProviderOptionsInput, undefined> = (
  modelID,
  settings = {},
) => {
  AnthropicCompatible.requireOneCredential(anthropic.id, settings, "Anthropic")
  return entrypoint(modelID, settings)
}

export * as Anthropic from "./anthropic.js"
