import type { ProfileSite } from "./profile/ipc"

/**
 * The listed site that is exactly a page's site, its registrable domain as `cookieSite` gives it, for the import to
 * choose. Never a site that only contains the name or ends with it: `hub.com` is not `github.com`.
 */
export function exactSite(sites: readonly ProfileSite[], site: string) {
  return sites.find((item) => item.site === site)
}

/**
 * The sites that match what the user typed in the import dialog, in the list's order: a part of a site's name, or the
 * host of a pasted address, which also matches the site it is a subdomain of. Only the parsed host is matched that way,
 * never the rest of an address. Names are ASCII, as browsers store them, so a Unicode name matches its punycode. An
 * empty search keeps every site.
 */
export function matchSites(sites: readonly ProfileSite[], query: string) {
  const text = query.trim().toLowerCase()

  if (!text) return sites
  const host = URL.parse(text)?.hostname || URL.parse(`http://${text}`)?.hostname

  return sites.filter(
    (item) => item.site.includes(text) || (!!host && (item.site.includes(host) || host.endsWith(`.${item.site}`))),
  )
}
