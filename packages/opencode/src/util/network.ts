import { Log } from "./log"

export namespace Network {
  const log = Log.create({ service: "network" })

  // Blocked domains - requests to these will be rejected
  const WEB_DOMAIN = process.env.WEB_DOMAIN || "opencode.j9xym.com"
  const API_DOMAIN = process.env.API_DOMAIN || "opencode.j9xym.com"
  const BLOCKED_DOMAINS = new Set(["api.opencode.ai", "opencode.ai", "opncd.ai", "dev.opencode.ai", "dev.opncd.ai"])

  // Allowed domains - only these are permitted for session/share operations
  const ALLOWED_API_DOMAINS = new Set([API_DOMAIN, WEB_DOMAIN, "localhost", "127.0.0.1"])

  // Track requests for debugging
  interface RequestLog {
    url: string
    method: string
    timestamp: number
    stack?: string
    blocked: boolean
  }

  const requestHistory: RequestLog[] = []
  const MAX_HISTORY = 1000

  let enabled = false
  let originalFetch: typeof globalThis.fetch | null = null

  function getCallerStack(): string {
    const stack = new Error().stack || ""
    // Skip first 3 lines (Error, getCallerStack, interceptedFetch)
    return stack.split("\n").slice(3, 8).join("\n")
  }

  function isBlockedDomain(url: string): boolean {
    try {
      const parsed = new URL(url)
      return BLOCKED_DOMAINS.has(parsed.hostname)
    } catch {
      return false
    }
  }

  function logRequest(entry: RequestLog) {
    requestHistory.push(entry)
    if (requestHistory.length > MAX_HISTORY) {
      requestHistory.shift()
    }

    if (entry.blocked) {
      log.warn("blocked request", {
        url: entry.url,
        method: entry.method,
      })
    } else {
      log.debug("network request", {
        url: entry.url,
        method: entry.method,
      })
    }
  }

  export function init() {
    if (enabled) return
    enabled = true
    originalFetch = globalThis.fetch

    const interceptedFetch = async function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      const method = init?.method || "GET"

      const blocked = isBlockedDomain(url)

      const entry: RequestLog = {
        url,
        method,
        timestamp: Date.now(),
        // Only capture stack trace for blocked requests (expensive operation)
        stack: blocked ? getCallerStack() : undefined,
        blocked,
      }

      if (blocked) {
        logRequest(entry)
        throw new Error(`Network request blocked: ${url} is on the blocked domain list. Use your own API endpoints.`)
      }

      logRequest(entry)
      return originalFetch!(input, init)
    }

    // Copy over the preconnect property from the original fetch
    Object.assign(interceptedFetch, { preconnect: originalFetch.preconnect })

    globalThis.fetch = interceptedFetch as typeof fetch

    log.info("network filter initialized", {
      blocked: Array.from(BLOCKED_DOMAINS),
      allowed: Array.from(ALLOWED_API_DOMAINS),
    })
  }

  export function disable() {
    if (!enabled || !originalFetch) return
    globalThis.fetch = originalFetch
    originalFetch = null
    enabled = false
    log.info("network filter disabled")
  }

  export function getHistory(): RequestLog[] {
    return [...requestHistory]
  }

  export function getBlockedRequests(): RequestLog[] {
    return requestHistory.filter((r) => r.blocked)
  }

  export function clearHistory() {
    requestHistory.length = 0
  }

  export function addBlockedDomain(domain: string) {
    BLOCKED_DOMAINS.add(domain)
    log.info("added blocked domain", { domain })
  }

  export function removeBlockedDomain(domain: string) {
    BLOCKED_DOMAINS.delete(domain)
    log.info("removed blocked domain", { domain })
  }

  export function addAllowedDomain(domain: string) {
    ALLOWED_API_DOMAINS.add(domain)
    log.info("added allowed domain", { domain })
  }

  export function isEnabled(): boolean {
    return enabled
  }
}
