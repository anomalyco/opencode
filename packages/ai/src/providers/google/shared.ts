import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"
import { Auth } from "../../route/auth.js"

export type ConnectionSettings = ProviderPackage.Settings & {
  readonly apiKey?: string | false
  readonly baseURL?: string
}

/** What every Google AI Studio API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "google",
  baseURL: "https://generativelanguage.googleapis.com/v1beta",
  auth: Provider.apiKey("GOOGLE_GENERATIVE_AI_API_KEY", Auth.header("x-goog-api-key")),
} satisfies Omit<Provider.Input<[]>, "apis">
