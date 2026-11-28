import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"

export type Settings<Options> = ProviderPackage.Settings &
  Options & {
    readonly apiKey?: string | false
    readonly baseURL?: string
    readonly queryParams?: Readonly<Record<string, string>>
  }

/** What every Venice API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "venice",
  baseURL: "https://api.venice.ai/api/v1",
  auth: Provider.apiKey("VENICE_API_KEY"),
  settings: {
    keys: ["queryParams"],
    patch: (values: { readonly queryParams?: Readonly<Record<string, string>> }) => ({ query: values.queryParams }),
  },
} satisfies Omit<Provider.Input<[]>, "apis">
