import type { Context, Env, Input } from "hono"

/**
 * Check if the current request is from localhost.
 */
export function isLocalhost<E extends Env = Env, P extends string = string, I extends Input = Input>(
  c: Context<E, P, I>,
): boolean {
  const host = c.req.header("Host") ?? ""

  // Check for localhost variations with or without port
  if (host === "localhost" || host.startsWith("localhost:")) return true
  if (host === "127.0.0.1" || host.startsWith("127.0.0.1:")) return true
  if (host === "::1" || host.startsWith("::1:")) return true
  if (host === "[::1]" || host.startsWith("[::1]:")) return true

  return false
}

/**
 * Check if the current connection is secure (HTTPS).
 *
 * When trustProxy is true, checks Forwarded/X-Forwarded-Proto headers first.
 * Falls back to direct connection protocol check.
 */
export function isSecureConnection<E extends Env = Env, P extends string = string, I extends Input = Input>(
  c: Context<E, P, I>,
  trustProxy: boolean,
): boolean {
  // Check proxy headers when behind proxy
  if (trustProxy) {
    const forwardedProto = parseForwardedProto(c.req.header("Forwarded"))
    if (forwardedProto) return forwardedProto === "https"

    const xForwardedProto = parseXForwardedProto(c.req.header("X-Forwarded-Proto"))
    if (xForwardedProto) return xForwardedProto === "https"
  }

  // Fall back to checking direct connection protocol
  try {
    const url = new URL(c.req.url)
    return url.protocol === "https:"
  } catch {
    return false
  }
}

function parseXForwardedProto(header: string | undefined): string | undefined {
  if (!header) return undefined

  const first = header.split(",")[0]?.trim()
  if (!first) return undefined

  return first.toLowerCase()
}

function parseForwardedProto(header: string | undefined): string | undefined {
  if (!header) return undefined

  const first = header.split(",")[0]?.trim()
  if (!first) return undefined

  for (const part of first.split(";")) {
    const [rawKey, rawValue] = part.split("=", 2)
    if (!rawKey || rawValue === undefined) continue
    if (rawKey.trim().toLowerCase() !== "proto") continue

    let value = rawValue.trim()
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.slice(1, -1)
    }
    if (!value) return undefined
    return value.toLowerCase()
  }

  return undefined
}

/**
 * Determine if insecure login should be blocked based on configuration.
 *
 * Returns true if:
 * - requireHttps is 'block'
 * - Connection is not localhost
 * - Connection is not secure
 */
export function shouldBlockInsecureLogin<E extends Env = Env, P extends string = string, I extends Input = Input>(
  c: Context<E, P, I>,
  config: { requireHttps: "off" | "warn" | "block"; trustProxy?: boolean },
): boolean {
  // Never block if requireHttps is off
  if (config.requireHttps === "off") return false

  // Never block localhost (allow dev over HTTP)
  if (isLocalhost(c)) return false

  // Never block if connection is secure
  if (isSecureConnection(c, config.trustProxy ?? false)) return false

  // Block if requireHttps is 'block'
  return config.requireHttps === "block"
}

/**
 * Get comprehensive connection security information for login page.
 */
export function getConnectionSecurityInfo<E extends Env = Env, P extends string = string, I extends Input = Input>(
  c: Context<E, P, I>,
  config: { requireHttps: "off" | "warn" | "block"; trustProxy?: boolean },
): {
  isSecure: boolean
  isLocalhost: boolean
  shouldBlock: boolean
  shouldWarn: boolean
} {
  const localhost = isLocalhost(c)
  const secure = isSecureConnection(c, config.trustProxy ?? false)
  const shouldBlock = shouldBlockInsecureLogin(c, config)

  // Should warn when: not secure AND not localhost AND requireHttps is 'warn'
  const shouldWarn = !secure && !localhost && config.requireHttps === "warn"

  return {
    isSecure: secure,
    isLocalhost: localhost,
    shouldBlock,
    shouldWarn,
  }
}
