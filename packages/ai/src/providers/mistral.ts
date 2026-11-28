import type { ProviderPackage } from "../provider-package.js"
import { MistralChat } from "../protocols/mistral-chat.js"
import { Provider } from "../provider.js"

export type ProviderOptions = MistralChat.ProviderOptionsInput

export type Settings = ProviderPackage.Settings &
  ProviderOptions & {
    readonly apiKey?: string | false
    readonly baseURL?: string
  }

export const mistral = Provider.make({
  id: "mistral",
  baseURL: "https://api.mistral.ai/v1",
  auth: Provider.apiKey("MISTRAL_API_KEY"),
  apis: [MistralChat.api],
})

export const model = Provider.entrypoint<Settings, ProviderOptions>(mistral)

export * as Mistral from "./mistral.js"
