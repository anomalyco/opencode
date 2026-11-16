import type { ProfileSite } from "./profile/ipc"

/**
 * The sites that match what the user typed in the import dialog, in the list's order: a part of a site's name, or a
 * pasted address or subdomain of the site. Names are ASCII, as browsers store them, so a Unicode name matches its
 * punycode. An empty search keeps every site.
 */
export function matchSites(sites: readonly ProfileSite[], query: string) {
  const text = query.trim().toLowerCase()

  if (!text) return sites
  const host = URL.parse(text)?.hostname || URL.parse(`http://${text}`)?.hostname
  const terms = host && host !== text ? [text, host] : [text]

  return sites.filter((item) => terms.some((term) => item.site.includes(term) || term.endsWith(`.${item.site}`)))
}
