import * as os from "node:os"
import { Context } from "effect"
import { lazy } from "@/util/lazy"

// Host header validation. Defends against DNS rebinding attacks where a
// malicious site convinces the browser to resolve the attacker's domain to
// the user's loopback or LAN IP. Without this check, the browser would treat
// requests as same-origin with the attacker's domain, bypassing CORS, and the
// OpenCode server would happily process them (including shell-execution
// endpoints).
//
// Strategy: only accept Host headers that name an interface the listener is
// actually bound to. By default this means loopback (when listening on
// 127.0.0.1) plus any explicitly allow-listed hostnames (mDNS domain,
// `--allowed-host`, `server.allowedHosts` config).
//
// When binding to 0.0.0.0/:: the user has explicitly opted into network
// exposure, so the listener also accepts any of the machine's network
// interface addresses (so `http://192.168.x.x:<port>` keeps working without
// extra config) while still rejecting unknown Host values.

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

const LOCAL_INTERFACE_ADDRESSES = lazy<ReadonlySet<string>>(() => {
  const out = new Set<string>()
  try {
    const ifaces = os.networkInterfaces()
    for (const list of Object.values(ifaces)) {
      if (!list) continue
      for (const iface of list) {
        if (!iface.address) continue
        out.add(iface.address.toLowerCase())
      }
    }
  } catch {
    // ignore; loopback always covers the default case
  }
  return out
})

export type HostOptions = {
  /** The hostname the server is bound to (e.g. "127.0.0.1", "0.0.0.0", "opencode.local"). */
  readonly hostname?: string
  /** The mDNS service domain when mDNS publishing is active. */
  readonly mdnsDomain?: string
  /** Additional hostnames to accept in the Host header, e.g. from `--allowed-host` or config. */
  readonly allowedHosts?: ReadonlyArray<string>
}

export const HostConfig = Context.Reference<HostOptions | undefined>("@opencode/ServerHostConfig", {
  defaultValue: () => undefined,
})

function normalizeHost(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return undefined
  // Bracketed IPv6: [::1] or [::1]:8080
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]")
    if (end === -1) return undefined
    return trimmed.slice(0, end + 1)
  }
  const colons = (trimmed.match(/:/g) ?? []).length
  // Bare IPv6 with no brackets (multiple colons) — treat as full value.
  if (colons > 1) return trimmed
  // host:port form
  if (colons === 1) return trimmed.slice(0, trimmed.indexOf(":"))
  return trimmed
}

function isWildcardListener(hostname: string): boolean {
  return hostname === "0.0.0.0" || hostname === "::" || hostname === "[::]"
}

export function isAllowedHost(headerValue: string | undefined, opts?: HostOptions): boolean {
  // A Host header is required by HTTP/1.1; reject missing.
  if (!headerValue) return false
  const host = normalizeHost(headerValue)
  if (!host) return false
  if (LOOPBACK_HOSTS.has(host)) return true
  if (opts?.hostname) {
    const configured = opts.hostname.toLowerCase()
    if (configured && !isWildcardListener(configured) && host === configured) return true
    // When listening on 0.0.0.0/::, accept any of this machine's interface
    // addresses so LAN-IP access works without extra configuration. DNS
    // rebinding is still blocked because attacker.com isn't in this set.
    if (isWildcardListener(configured) && LOCAL_INTERFACE_ADDRESSES().has(host)) return true
  }
  if (opts?.mdnsDomain && host === opts.mdnsDomain.toLowerCase()) return true
  if (opts?.allowedHosts?.some((h) => h.toLowerCase() === host)) return true
  return false
}
