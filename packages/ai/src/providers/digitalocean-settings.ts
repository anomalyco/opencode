import type { Config, Settings } from "./digitalocean.js"

export function config({
  apiKey,
  baseURL,
  body,
  headers,
  ...providerOptions
}: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: { body },
    providerOptions,
  }
}
