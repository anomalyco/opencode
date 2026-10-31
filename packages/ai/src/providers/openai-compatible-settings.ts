import type { Settings } from "./openai-compatible.js"

export function config({ apiKey, baseURL, body, headers, provider, ...providerOptions }: Settings) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    provider,
    providerOptions,
  }
}
