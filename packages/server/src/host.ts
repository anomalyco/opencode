export * as ServerHost from "./host"

/**
 * Host header policy for the local HTTP server.
 *
 * The server binds to loopback by default, so every website the user visits can try to reach
 * it. A browser sends the target host in the Host header, and a page served from an attacker
 * domain can point that domain at 127.0.0.1 (DNS rebinding): the request then looks
 * same-origin to the page, so the browser omits the Origin header and the origin allowlist
 * never sees it. Rejecting Host headers that do not name the loopback interface closes that
 * path.
 */

const loopbackHostname = /^(?:localhost(?:\.[a-z0-9-]+)*|127(?:\.\d{1,3}){3}|\[::1\])$/i

export type Options = {
  /** The address the server binds to. Undefined means the runtime routes by host itself. */
  readonly hostname?: string
  /** Extra trusted hosts, such as the remote tunnel URL the server advertises. */
  readonly hosts?: ReadonlyArray<string>
}

/** Extracts the hostname from "host", "host:port", "[::1]:port" or a full URL. */
export function hostnameOf(value: string) {
  const trimmed = value.trim()
  if (trimmed === "") return undefined
  try {
    return new URL(trimmed.includes("://") ? trimmed : `http://${trimmed}`).hostname.toLowerCase()
  } catch {
    return undefined
  }
}

/**
 * Decides whether a request may be served, based on the Host header it carries.
 *
 * Hosts outside the loopback interface are refused unless they were declared trusted, because
 * a rebound domain resolves to the loopback address while keeping its own name.
 */
export function isAllowedRequestHost(input: string | undefined, options?: Options) {
  if (!input) return true
  const bound = options?.hostname ? hostnameOf(options.hostname) : undefined
  // Without a bind address the runtime routes by host itself, and a server bound to the
  // network is exposed on purpose; pinning its Host header would only break reverse proxies
  // and LAN names.
  if (!bound) return true
  if (!loopbackHostname.test(bound)) return true
  const hostname = hostnameOf(input)
  if (hostname === undefined) return false
  if (loopbackHostname.test(hostname)) return true
  return (options?.hosts ?? []).some((host) => hostnameOf(host) === hostname)
}
