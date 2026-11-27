import type { ProviderPackage } from "../../provider-package.js"
import { Provider } from "../../provider.js"

export type Settings<Options> = ProviderPackage.Settings & Options & { readonly apiKey?: string | false }

export const baseURL = "https://inference.do-ai.run/v1"

export const env = ["DIGITALOCEAN_ACCESS_TOKEN", "DIGITALOCEAN_API_KEY", "DO_INFERENCE_API_KEY"]

/** What every DigitalOcean API shares. Each per-API entrypoint builds a provider from it with only its own API. */
export const shared = {
  id: "digitalocean",
  baseURL,
  auth: Provider.apiKey(env),
} satisfies Omit<Provider.Input<[]>, "apis">
