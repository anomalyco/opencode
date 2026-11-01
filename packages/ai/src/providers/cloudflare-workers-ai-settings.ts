import type { Settings } from "./cloudflare-workers-ai.js"

export function config({ accountId, apiKey, baseURL, body, headers, ...providerOptions }: Settings) {
  return {
    ...(baseURL === undefined ? { accountId: accountId ?? "" } : { baseURL }),
    apiKey,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
