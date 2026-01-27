/**
 * Proxy-aware fetch wrapper for Bun
 *
 * Bun's native fetch() ignores HTTP_PROXY/HTTPS_PROXY environment variables.
 * This wrapper explicitly passes the proxy via Bun's { proxy: url } option.
 *
 * @see https://bun.com/docs/guides/http/proxy
 */

import type { Config } from "../config/config"

// Bun's fetch supports proxy option but TypeScript types don't include it
type BunFetchInit = RequestInit & {
  proxy?: string | { url: string; headers?: Record<string, string> }
}

/**
 * Internal proxy configuration state
 * Set via setProxyConfig() from opencode.json config
 */
let _configProxy: Config.ProxyConfig | undefined

/**
 * Set proxy configuration from opencode.json
 * Config values take precedence over environment variables
 */
export function setProxyConfig(config: Config.ProxyConfig | undefined): void {
  _configProxy = config
}

/**
 * Get current proxy configuration
 * Priority: config file > environment variables
 */
export function getProxyConfig(): {
  http?: string
  https?: string
  noProxy: string[]
} {
  return {
    http: _configProxy?.http || process.env.HTTP_PROXY || process.env.http_proxy,
    https: _configProxy?.https || process.env.HTTPS_PROXY || process.env.https_proxy,
    noProxy:
      _configProxy?.no_proxy ||
      (process.env.NO_PROXY || process.env.no_proxy || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
  }
}

/**
 * Check if a hostname should bypass the proxy based on NO_PROXY patterns
 *
 * Supported patterns:
 * - "*" - bypass all
 * - "hostname" - exact match
 * - "*.domain.com" - wildcard suffix
 * - ".domain.com" - suffix match
 * - "domain.com" - also matches *.domain.com
 */
export function shouldBypassProxy(hostname: string, noProxy: string[]): boolean {
  hostname = hostname.toLowerCase()

  for (const pattern of noProxy) {
    const p = pattern.toLowerCase().trim()

    // Match all
    if (p === "*") return true

    // Exact match
    if (hostname === p) return true

    // Wildcard: *.example.com
    if (p.startsWith("*.") && hostname.endsWith(p.slice(1))) return true

    // Suffix: .example.com
    if (p.startsWith(".") && hostname.endsWith(p)) return true

    // Domain suffix without dot (e.g., "example.com" matches "sub.example.com")
    if (hostname.endsWith("." + p)) return true
  }

  return false
}

/**
 * Get the proxy URL to use for a given URL
 * Returns undefined if no proxy should be used (NO_PROXY match or no proxy configured)
 */
export function getProxyForUrl(url: string | URL): string | undefined {
  // Feature flag to disable proxy entirely
  if (process.env.OPENCODE_DISABLE_PROXY) {
    return undefined
  }

  const urlObj = typeof url === "string" ? new URL(url) : url
  const config = getProxyConfig()

  if (shouldBypassProxy(urlObj.hostname, config.noProxy)) {
    return undefined
  }

  return urlObj.protocol === "https:" ? config.https : config.http
}

/**
 * Proxy-aware fetch wrapper
 *
 * Usage:
 * ```ts
 * import { proxyFetch } from "./util/fetch"
 *
 * // Auto-detect proxy from config/env
 * const response = await proxyFetch("https://api.example.com")
 *
 * // Explicitly disable proxy for this request
 * const response = await proxyFetch("https://localhost:3000", { proxy: false })
 *
 * // Explicitly set proxy for this request
 * const response = await proxyFetch("https://api.example.com", {
 *   proxy: "http://other-proxy:8080"
 * })
 * ```
 */
export async function proxyFetch(
  input: RequestInfo | URL,
  init?: BunFetchInit & { proxy?: string | false | { url: string; headers?: Record<string, string> } },
): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url

  // Proxy explicitly disabled for this request
  if (init?.proxy === false) {
    const { proxy: _, ...rest } = init
    return fetch(input, rest)
  }

  // Proxy explicitly provided for this request
  if (init?.proxy) {
    return fetch(input, init as RequestInit)
  }

  // Auto-detect proxy from config/env
  const proxyUrl = getProxyForUrl(url)

  if (proxyUrl) {
    return fetch(input, {
      ...init,
      proxy: proxyUrl,
    } as RequestInit)
  }

  return fetch(input, init)
}

// Named exports
export { proxyFetch as fetch }
export default proxyFetch
