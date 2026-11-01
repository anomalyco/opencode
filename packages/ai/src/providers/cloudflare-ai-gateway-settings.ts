import type { Settings } from "./cloudflare-ai-gateway.js"

export function config({
  accountId,
  apiKey,
  baseURL: configuredBaseURL,
  body,
  cacheKey,
  cacheTtl,
  collectLog,
  gatewayApiKey,
  gatewayId,
  headers,
  metadata,
  skipCache,
  ...providerOptions
}: Settings) {
  const connection = configuredBaseURL === undefined ? { accountId: accountId ?? "" } : { baseURL: configuredBaseURL }
  return {
    ...connection,
    apiKey,
    cacheKey,
    cacheTtl,
    collectLog,
    gatewayApiKey,
    gatewayId,
    headers,
    http: body === undefined ? undefined : { body },
    metadata,
    providerOptions,
    skipCache,
  }
}
