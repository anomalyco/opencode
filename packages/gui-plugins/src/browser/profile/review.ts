import { Schema } from "effect"
import { getDomain } from "tldts"
import { displayHost } from "../host-display"
import { extensionAccess, reviewHosts } from "./compatibility"
import { coversPattern } from "./extension-api/match-pattern"
import type { Manifest } from "./extensions"
import type { ReviewedGrants } from "./ipc"

/** Summaries never replace the complete grant set used by Details and the next install's comparison. */
export function reviewAccess(manifest: Manifest, previous?: ReviewedGrants) {
  const hosts = reviewHosts(manifest)
  const patterns = new Set(hosts)
  const permissions = (manifest.permissions ?? []).filter(Schema.is(Schema.String)).filter((item) => !patterns.has(item))
  const access = extensionAccess(manifest)
  const grants = { hosts, permissions, access }

  const sites = [...new Set(hosts.flatMap((pattern) => {
    const authority = /^[^:]+:\/\/(\*\.)?([^/]+)\//.exec(pattern)
    const host = authority?.[2] && URL.parse(`https://${authority[2]}`)?.hostname

    if (!host || host === "*") return []

    // Include private suffixes: github.io tenants are not one site. Keep wildcard public suffixes broad and visible.
    // Named as every host in the pane is (`displayHost`): ASCII, and the end of a long one kept.
    const domain = getDomain(host, { allowPrivateDomains: true })
    const site = displayHost(`https://${domain ?? host}/`)

    return domain || !authority?.[1] ? site : `*.${site}`
  }))].sort()

  const added = previous && {
    access: access.filter((item) => !previous.access.includes(item) && !(item === "someSites" && previous.access.includes("allSites"))),
    hosts: hosts.filter((item) => !previous.hosts.some((grant) => grant === item || coversPattern(grant, item))),
    permissions: permissions.filter((item) => !previous.permissions.includes(item)),
  }

  return { grants, sites, added: added && (added.access.length || added.hosts.length || added.permissions.length) ? added : undefined }
}
