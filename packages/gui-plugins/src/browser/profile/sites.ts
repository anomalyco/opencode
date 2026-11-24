import { parse } from "tldts"

/** A cookie of another browser as the site list counts it: its host, expiry and last use, never its name or value. */
export type CookieHost = {
  /** As browsers store it: `.github.com` for a domain cookie, `github.com` for a host-only one. */
  readonly host: string
  /** Unix seconds; undefined for a session cookie. */
  readonly expires: number | undefined
  /** When the browser last sent it, in Unix seconds; 0 where the browser does not record it. */
  readonly used: number
}

/** One row of the site list: a registrable domain and how many of its cookies would import. */
export type ProfileSite = { readonly site: string; readonly cookies: number }

/**
 * The site a cookie host belongs to: its registrable domain, so every subdomain of one site is one row. Private
 * suffixes count, as Chromium scopes cookies by them: `alice.github.io` and `bob.github.io` are two sites. An IP
 * address, `localhost` or a bare suffix is its own site. Names are ASCII, as browsers store them; a Unicode name in a
 * cookie file becomes punycode. Undefined for a host that names no site.
 */
export function cookieSite(host: string) {
  const bare = host.replace(/^\./, "").toLowerCase()
  const hostname = bare && URL.parse(`http://${bare.includes(":") && !bare.startsWith("[") ? `[${bare}]` : bare}/`)?.hostname

  if (!hostname) return undefined
  const parsed = parse(hostname, { allowPrivateDomains: true })

  if (parsed.isIp) return hostname

  return parsed.domain ?? hostname.replace(/\.$/, "")
}

/**
 * The sites of a profile's cookies, with how many of each would import: expired cookies do not count. The sites used
 * most recently come first, so the ones the person works in lead a list of thousands; then by name.
 */
export function groupSites(cookies: readonly CookieHost[], now: number): ProfileSite[] {
  const sites = new Map<string, { cookies: number; used: number }>()
  const named = new Map<string, string | undefined>()

  cookies.forEach((cookie) => {
    if (cookie.expires !== undefined && cookie.expires <= now) return
    const site = named.has(cookie.host) ? named.get(cookie.host) : cookieSite(cookie.host)
    named.set(cookie.host, site)

    // A host longer than any name a browser sends cookies to is damage, and leaves the list.
    if (!site || site.length > 255) return
    const current = sites.get(site)
    sites.set(site, { cookies: (current?.cookies ?? 0) + 1, used: Math.max(current?.used ?? 0, cookie.used) })
  })

  // Names are ASCII, so code-unit order is alphabetical.
  return [...sites]
    .toSorted((a, b) => b[1].used - a[1].used || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([site, entry]) => ({ site, cookies: entry.cookies }))
}

/** Whether a cookie host belongs to one of the chosen sites, for an import of only those. */
export function siteFilter(sites: readonly string[]) {
  const chosen = new Set(sites)
  const named = new Map<string, boolean>()

  return (host: string) => {
    const known = named.get(host)

    if (known !== undefined) return known
    const site = cookieSite(host)
    const kept = site !== undefined && chosen.has(site)
    named.set(host, kept)

    return kept
  }
}
