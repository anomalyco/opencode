import { createOpenRouter } from "@openrouter/ai-sdk-provider"
import type { Provider as SDK } from "ai"
import type { KiloProviderOptions } from "./types.js"
import { getKiloUrlFromToken, getApiKey } from "./auth/token.js"
import { buildKiloHeaders, DEFAULT_HEADERS } from "./headers.js"
import { KILO_API_BASE, ANONYMOUS_API_KEY } from "./api/constants.js"

/**
 * Create a KiloCode provider instance
 *
 * This provider wraps the OpenRouter SDK with KiloCode-specific configuration
 * including custom authentication, headers, and base URL.
 *
 * @example
 * ```typescript
 * const provider = createKilo({
 *   kilocodeToken: "your-token-here",
 *   kilocodeOrganizationId: "org-123"
 * })
 *
 * const model = provider.languageModel("anthropic/claude-sonnet-4")
 * ```
 */
export function createKilo(options: KiloProviderOptions = {}): SDK {
  // Get API key from options or environment
  const apiKey = getApiKey(options)

  // Determine base URL
  const baseApiUrl = getKiloUrlFromToken(options.baseURL ?? KILO_API_BASE, apiKey ?? "")

  // Build OpenRouter URL - only append /openrouter/ if not already present
  const openRouterUrl = baseApiUrl.includes("/openrouter")
    ? baseApiUrl
    : baseApiUrl.endsWith("/")
      ? `${baseApiUrl}openrouter/`
      : `${baseApiUrl}/openrouter/`

  // Merge custom headers with defaults
  const customHeaders = {
    ...DEFAULT_HEADERS,
    ...buildKiloHeaders(undefined, {
      kilocodeOrganizationId: options.kilocodeOrganizationId,
      kilocodeTesterWarningsDisabledUntil: undefined,
    }),
    ...options.headers,
  }

  // Create custom fetch wrapper to add dynamic headers
  const originalFetch = options.fetch ?? fetch
  const wrappedFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)

    // Add custom headers
    Object.entries(customHeaders).forEach(([key, value]) => {
      headers.set(key, value)
    })

    // Add authorization if API key exists
    if (apiKey) {
      headers.set("Authorization", `Bearer ${apiKey}`)
    }

    return originalFetch(input, {
      ...init,
      headers,
    })
  }

  // Create OpenRouter provider with KiloCode configuration
  return createOpenRouter({
    baseURL: openRouterUrl,
    apiKey: apiKey ?? ANONYMOUS_API_KEY,
    headers: customHeaders,
    fetch: wrappedFetch as typeof fetch,
  })
}
