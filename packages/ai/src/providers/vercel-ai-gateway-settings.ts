import type { Settings } from "./vercel-ai-gateway.js"

export function config({ apiKey, baseURL, headers, body, ...providerOptions }: Settings = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
