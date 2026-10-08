/** How another device reaches this machine's server, which decides the label the pairing page shows. */
export type RouteKind = "custom" | "local" | "vpn" | "other"

/** An address another device can open, with the kind of network it travels over. */
export type PairingRoute = { readonly url: string; readonly kind: RouteKind }

const order: Record<RouteKind, number> = { custom: 0, local: 1, vpn: 2, other: 3 }

/**
 * The addresses a pairing link can use: the saved custom address first, then the server's advertised addresses that
 * another device could reach. Loopback and wildcard addresses only work on this machine, so they drop out.
 */
export function pairingRoutes(urls: readonly string[], custom: string) {
  const advertised = urls.flatMap((value): PairingRoute[] => {
    const url = URL.parse(value)
    const kind = url ? routeKind(url.hostname) : undefined

    return url && kind ? [{ url: url.origin, kind }] : []
  })

  // The stored address is checked again on read, so a malformed stored value cannot break the page.
  const origin = customAddress(custom)
  const routes: PairingRoute[] = origin ? [{ url: origin, kind: "custom" }, ...advertised] : advertised

  return routes
    .filter((route, index) => routes.findIndex((other) => other.url === route.url) === index)
    .toSorted((a, b) => order[a.kind] - order[b.kind] || Number(linkLocal(a.url)) - Number(linkLocal(b.url)))
}

/**
 * The origin of an address the user typed for other devices, or undefined when it is not one. Pairing links replace
 * the path, so an address with a path, query, hash or credentials would send devices somewhere else.
 */
export function customAddress(value: string) {
  const url = URL.parse(value.trim())

  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) return

  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return

  return url.origin
}

// A link-local address works only without a router in between, so it is offered after the other local addresses.
function linkLocal(url: string) {
  return new URL(url).hostname.startsWith("169.254.")
}

function routeKind(hostname: string): RouteKind | undefined {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase()

  if (host === "localhost" || host.endsWith(".localhost") || host === "::1" || host === "::") return

  // A browser cannot open an IPv6 link-local address without its zone, so fe80:: addresses drop out too.
  if (/^(127|0)\./.test(host) || host.startsWith("fe80:")) return

  // 100.64.0.0/10 is shared address space; on a computer it almost always belongs to a mesh VPN, as does fd7a:115c:a1e0::/48.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) || host.startsWith("fd7a:115c:a1e0:")) return "vpn"

  // 169.254.0.0/16 reaches devices on the same link, such as a direct cable without DHCP (RFC 3927).
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host))
    return "local"

  return "other"
}
