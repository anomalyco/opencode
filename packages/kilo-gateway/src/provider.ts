import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { Provider as SDK } from "ai"
import type { KiloProviderOptions } from "./types.js"
import { getKiloUrlFromToken, getApiKey } from "./auth/token.js"
import { buildKiloHeaders, DEFAULT_HEADERS } from "./headers.js"
import { KILO_API_BASE, ANONYMOUS_API_KEY } from "./api/constants.js"
import { normalizeKiloOpenRouterURL } from "./url.js"

export function createKilo(options: KiloProviderOptions = {}): SDK {
  const apiKey = getApiKey(options)

  const baseApiUrl = getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, apiKey ?? "")

  let openRouterUrl = baseApiUrl.includes("/openrouter")
    ? baseApiUrl
    : baseApiUrl.endsWith("/")
      ? `${baseApiUrl}openrouter/`
      : `${baseApiUrl}/openrouter/`

  openRouterUrl = normalizeKiloOpenRouterURL(openRouterUrl)

  const customHeaders = {
    ...DEFAULT_HEADERS,
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: options.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }

  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)

    Object.entries(customHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })

    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`)
    }

    return originalFetch(input, {
      ...init,
      headers,
    })
  }

  return createOpenRouter({
    baseURL: openRouterUrl,
    apiKey: apiKey ?? ANONYMOUS_API_KEY,
    headers: customHeaders,
    fetch: wrappedFetch as typeof fetch,
  })
}
