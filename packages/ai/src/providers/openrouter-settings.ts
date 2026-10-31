import type { Config, Settings } from "./openrouter.js"

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
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
