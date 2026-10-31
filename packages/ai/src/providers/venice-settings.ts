import type { Config, Settings } from "./venice.js"

export function config({
  apiKey,
  baseURL,
  queryParams,
  body,
  headers,
  ...providerOptions
}: Settings<Config["providerOptions"]> = {}) {
  return {
    apiKey,
    baseURL,
    queryParams,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
