import type { Settings } from "./minimax.js"

export function config({ apiKey, baseURL, body, headers, ...providerOptions }: Settings<{}> = {}) {
  return {
    apiKey,
    baseURL,
    headers,
    http: body === undefined ? undefined : { body },
    providerOptions,
  }
}
