// Gallery host enumeration (model-gallery-ui task 5.1).
//
// The gallery does NOT discover hosts. opencode already knows how to find
// llama-skein instances — mDNS, localhost, and configured providers, all
// behind scanLlamaSwap — and a second mechanism would drift from the first the
// moment either changed, giving the user a gallery that lists different hosts
// than the provider picker on the same screen. This module is a projection of
// that existing result, not a parallel implementation.
//
// The one thing it does add is a *stable identity*, because task 5.3 has to
// join fit verdicts, inventory and capacity across separate async calls, and
// service names are not usable as keys: mDNS names change with a host's
// advertised TXT record, and reverse-DNS names are frequently wrong.

import { scanLlamaSwap } from "../mdns"

/** A llama-skein host the gallery can consider, projected from discovery. */
export type GalleryHost = {
  /**
   * Stable join key. The normalized base URL, because that is the only
   * identifier that survives a rename and is guaranteed unique per endpoint.
   */
  id: string
  /** Display name from discovery. Never used as a key. */
  name: string
  baseURL: string
  source: "mdns" | "localhost" | "lan"
  /** False when the host was found but did not answer its model list. */
  online: boolean
  /** Model IDs the host currently serves. Empty when offline. */
  installedModelIDs: readonly string[]
  defaultModel: string | null
}

/** Normalizes a base URL into a join key: no trailing slash, lowercased. */
export function hostId(baseURL: string): string {
  return baseURL.replace(/\/+$/, "").toLowerCase()
}

export type DiscoverOptions = {
  timeoutMs?: number
  /** Injected for tests; defaults to opencode's existing discovery. */
  scan?: typeof scanLlamaSwap
}

/**
 * Enumerate hosts the gallery may offer. Offline hosts are RETAINED rather
 * than filtered: task 5.6 has to classify a candidate as "offline" on a host
 * the user knows exists, and dropping the host here would make that
 * indistinguishable from the host never having existed.
 */
export async function discoverGalleryHosts(options: DiscoverOptions = {}): Promise<GalleryHost[]> {
  const scan = options.scan ?? scanLlamaSwap
  const found = await scan(options.timeoutMs ?? 1000, true)

  const byId = new Map<string, GalleryHost>()
  for (const svc of found) {
    const id = hostId(svc.baseURL)
    const host: GalleryHost = {
      id,
      name: svc.name,
      baseURL: svc.baseURL,
      source: svc.source,
      online: svc.online,
      installedModelIDs: svc.models ?? [],
      defaultModel: svc.defaultModel ?? null,
    }
    // The same endpoint can legitimately be discovered twice (mDNS and
    // localhost both find a local instance). Prefer the entry that actually
    // answered, then the more authoritative source — mDNS carries the
    // machine's own advertised identity, where "lan" is reverse-DNS guesswork.
    const existing = byId.get(id)
    if (!existing || preferHost(host, existing)) byId.set(id, host)
  }
  // Sorted so a gallery listing is stable between refreshes rather than
  // reordering under the user as discovery races resolve differently.
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id))
}

const SOURCE_RANK: Record<GalleryHost["source"], number> = { mdns: 0, localhost: 1, lan: 2 }

function preferHost(candidate: GalleryHost, existing: GalleryHost): boolean {
  if (candidate.online !== existing.online) return candidate.online
  return SOURCE_RANK[candidate.source] < SOURCE_RANK[existing.source]
}
