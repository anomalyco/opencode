import { lookup } from "dns/promises"
import { isIP } from "net"

// SSRF protection for the webfetch tool: reject URLs that point at loopback,
// private, link-local, or otherwise non-public network targets BEFORE connecting.
//
// Opt-out for local development (e.g. fetching a dev server on purpose):
// set
//OPEN_CODE_WEBFETCH_ALLOW_PRIVATE=1. Read lazily so tests can toggle it.
//
// Known limitation: the DNS check and the subsequent connect are two resolutions
// (TOCTOU), so a DNS-rebinding attacker who controls the queried zone could still
// race it. Pinning the resolved IP for the connect is intentionally out of scope here.

function allowPrivate() {
  const value = process.env.OPENCODE_WEBFETCH_ALLOW_PRIVATE?.toLowerCase()
  return value === "1" || value === "true"
}

const BLOCKED_HOSTNAMES = new Set(["localhost", "localhost.localdomain", "broadcasthost"])
// RFC 6761 .localhost plus the internal suffixes commonly used on LANs
const BLOCKED_SUFFIXES = [".localhost", ".internal", ".lan", ".local", ".home.arpa", ".corp", ".intranet"]

export function isBlockedHostname(hostname: string) {
  const h = hostname.toLowerCase().replace(/\.$/, "")
  if (BLOCKED_HOSTNAMES.has(h)) return true
  return BLOCKED_SUFFIXES.some((suffix) => h.endsWith(suffix))
}

function isPrivateIpv4(ip: string) {
  const [a, b, c] = ip.split(".").map(Number)
  if (a === 0) return true // "this" network
  if (a === 10) return true // RFC 1918
  if (a === 127) return true // loopback
  if (a === 169 && b === 254) return true // link-local (incl. cloud metadata 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true // RFC 1918
  if (a === 192 && b === 168) return true // RFC 1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true // IETF assignments / TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true // benchmarking
  if (a === 198 && b === 51 && c === 100) return true // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // TEST-NET-3
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  return a >= 224 // multicast 224/4, reserved 240/4, broadcast 255.255.255.255
}

function isPrivateIpv6(input: string) {
  const ip = input.toLowerCase()
  if (ip === "::" || ip === "::1") return true
  // IPv4-embedded forms (e.g. ::ffff:127.0.0.1, 64:ff9b::8.8.8.8): check the tail
  if (ip.includes(".")) {
    return isPrivateIpv4(ip.slice(ip.lastIndexOf(":") + 1))
  }
  // ::ffff:aabb:cccc hex-mapped form
  const mapped = ip.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (mapped) {
    const hi = parseInt(mapped[1], 16)
    const lo = parseInt(mapped[2], 16)
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
  }
  const hextets = ip.split(":")
  // Full uncompressed form: all-zero is unspecified, ...1 is loopback
  if (hextets.length === 8 && hextets.slice(0, 7).every((h) => parseInt(h || "0", 16) === 0)) {
    const last = parseInt(hextets[7], 16)
    if (last === 0 || last === 1) return true
  }
  const first = parseInt(hextets[0] || "0", 16)
  if (first >= 0xfc00 && first <= 0xfdff) return true // unique-local fc00::/7
  if (first >= 0xfe80 && first <= 0xfebf) return true // link-local fe80::/10
  if (first >= 0xff00) return true // multicast ff00::/8
  if (first === 0x2001 && hextets[1] === "db8") return true // documentation 2001:db8::/32
  return false
}

export function isPrivateIp(ip: string) {
  const version = isIP(ip)
  if (version === 4) return isPrivateIpv4(ip)
  if (version === 6) return isPrivateIpv6(ip)
  return false
}

function blocked(hostname: string, detail: string) {
  return new Error(
    `Blocked: "${hostname}" ${detail}. The webfetch tool does not fetch private/internal network addresses (SSRF protection). ` +
      `Set
  OPEN_CODE_WEBFETCH_ALLOW_PRIVATE=1 to override for local development.`,
  )
}

// Throws when the URL targets a private/internal address; resolves hostnames and
// rejects if ANY resolved address is non-public. WHATWG URL parsing normalizes
// non-standard IPv4 forms (decimal/hex/octal) before the checks run.
export async function assertPublicUrl(input: string) {
  if (allowPrivate()) return

  const url = new URL(input)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Blocked: scheme "${url.protocol}" is not allowed. The webfetch tool only fetches http/https URLs.`)
  }

  // Strip the brackets WHATWG keeps around IPv6 literals
  const hostname = url.hostname.replace(/^\[|\]$/g, "")
  if (isBlockedHostname(hostname)) throw blocked(hostname, "is a loopback/internal hostname")

  const version = isIP(hostname)
  if (version !== 0) {
    if (isPrivateIp(hostname)) throw blocked(hostname, "is a private/internal IP address")
    return
  }

  // Literal-looking but non-standard IPv4 already normalized above; for real hostnames,
  // fail closed on private resolutions. Unresolvable names are left to the fetch itself.
  const addresses = await lookup(hostname, { all: true, verbatim: true }).catch(() => [] as { address: string }[])
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw blocked(hostname, "resolves to a private/internal address")
  }
}
