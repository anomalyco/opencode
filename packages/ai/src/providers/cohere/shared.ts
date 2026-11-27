import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import type { OpenString } from "../../schema/index.js"

export type ChatOptionsInput = { readonly reasoningEffort?: OpenString<"none" | "high"> }

export type Settings<Options> = ProviderPackage.Settings &
  Options & { readonly apiKey?: string | false; readonly baseURL?: string }

export const compatibilityBaseURL = "https://api.cohere.ai/compatibility/v1"

/** What every Cohere API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "cohere",
  baseURL: "https://api.cohere.com/v2",
  auth: Provider.apiKey("COHERE_API_KEY"),
} satisfies Omit<Provider.Input<[]>, "apis">
