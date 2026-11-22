import { completes, frequency, matchQuality, MISS, parseQuery, recency, searchText, START, type Query } from "./match"
import { bare, type PageVisit } from "./page"

/** A page the address field may suggest, as a search returns it. */
export type FoundPage = {
  readonly url: string
  readonly title: string
  /**
   * How often and how recently it was visited; see `frecency`. For a site's front page that answers a typed host, the
   * sum over the site's pages that begin with what was typed.
   */
  readonly score: number
}

/** A page's address and title as they are shown, which the index does not hold. */
type Shown = { readonly url: string; readonly title: string }

export type PageIndex = ReturnType<typeof createPageIndex>

/** A page as a search reads it: its `searchText`, its host and its visits. */
type Entry = {
  readonly id: number
  readonly text: string
  /** The host as the address shows it: in lower case, without `www.`, with its port. */
  readonly host: string
  /** Its `frequency`, which changes only with a visit. */
  readonly frequency: number
  readonly visited: number
}

/** A page a search found: how well it matches (see `matchQuality`) and its `frecency`. */
export type Found = { readonly id: number; readonly quality: number; readonly score: number }

/**
 * The host a typed text most likely begins: among the hosts with a page whose address begins with it, the one whose
 * such pages have the most frecency in sum, which is `score`, and the best of those pages.
 */
export type FoundHost = { readonly host: string; readonly score: number; readonly page: number }

/** A host's sum while a search runs; `best` is the frecency of `page`. */
type HostSum = { host: string; score: number; page: number; best: number }

/**
 * Every page of the history in memory, in the form a search compares, so a keystroke costs one pass over them and no
 * database read. The store keeps it in step with the database; it holds no address or title as they are shown.
 */
export function createPageIndex() {
  const entries: Entry[] = []
  // Where each page is in `entries`, by its id.
  const slots = new Map<number, number>()
  // Each host once, however many pages it has: a host cut from an address would keep that whole address in memory.
  const hosts = new Map<string, string>()

  const hostOf = (url: string) => {
    const address = bare(url).toLowerCase()
    const end = address.search(/[/?#]/)
    const host = end < 0 ? address : address.slice(0, end)
    const known = hosts.get(host)

    if (known === undefined) hosts.set(host, host)

    return known ?? host
  }

  const remove = (id: number) => {
    const slot = slots.get(id)
    const last = entries.pop()

    if (slot === undefined || !last) return
    slots.delete(id)

    // The last page takes the removed one's place, so the list has no holes.
    if (last.id === id) return
    entries[slot] = last
    slots.set(last.id, slot)
  }

  return {
    size: () => entries.length,
    set(id: number, page: PageVisit) {
      const entry: Entry = {
        id,
        text: searchText(page.url, page.title),
        host: hostOf(page.url),
        frequency: frequency(page.visits, page.typed),
        visited: page.visited,
      }

      const slot = slots.get(id)

      if (slot !== undefined) return void (entries[slot] = entry)
      slots.set(id, entries.length)
      entries.push(entry)
    },
    remove,
    clear() {
      entries.length = 0
      slots.clear()
      hosts.clear()
    },
    /**
     * The `limit` pages that match best: by how well they match, then by frecency, then the most recent, then the
     * one the history has had longest. When the query may begin a host, also the host it most likely begins.
     */
    search(query: Query, limit: number, now: number) {
      const top: (Found & { readonly entry: Entry })[] = []
      const sums = query.words.length === 1 && !/[/?#]/.test(query.words[0] ?? "") ? new Map<string, HostSum>() : undefined

      // Runs on each keystroke over every page: a plain loop, and an allocation only for a page that enters the top.
      for (const entry of entries) {
        const quality = matchQuality(query, entry.text)

        if (quality === MISS) continue
        const score = entry.frequency * recency(entry.visited, now)

        if (sums && completes(query, entry.text)) {
          const known = sums.get(entry.host)

          if (!known) sums.set(entry.host, { host: entry.host, score, page: entry.id, best: score })

          if (known) {
            known.score += score

            if (score > known.best) {
              known.page = entry.id
              known.best = score
            }
          }
        }

        const worst = top.length === limit ? top[limit - 1] : undefined

        // Most pages that match fall below the top, on these two numbers alone.
        if (worst && (quality < worst.quality || (quality === worst.quality && score < worst.score))) continue

        if (worst && !before(quality, score, entry, worst)) continue
        const at = top.findIndex((item) => before(quality, score, entry, item))
        top.splice(at < 0 ? top.length : at, 0, { id: entry.id, quality, score, entry })

        if (top.length > limit) top.pop()
      }

      const host = sums
        ? [...sums.values()].reduce<HostSum | undefined>((best, item) => (!best || item.score > best.score ? item : best), undefined)
        : undefined

      return {
        pages: top.map((item): Found => ({ id: item.id, quality: item.quality, score: item.score })),
        host: host ? ({ host: host.host, score: host.score, page: host.page } satisfies FoundHost) : undefined,
      }
    },
    /** The ids of the pages to drop so that `keep` remain: the ones visited least and longest ago. */
    least(keep: number, now: number) {
      if (entries.length <= keep) return []

      return entries
        .map((entry) => ({ id: entry.id, score: entry.frequency * recency(entry.visited, now), visited: entry.visited }))
        .toSorted((a, b) => a.score - b.score || a.visited - b.visited)
        .slice(0, entries.length - keep)
        .map((item) => item.id)
    },
  }
}

function before(quality: number, score: number, entry: Entry, other: Found & { readonly entry: Entry }) {
  if (quality !== other.quality) return quality > other.quality

  if (score !== other.score) return score > other.score

  if (entry.visited !== other.entry.visited) return entry.visited > other.entry.visited

  return entry.id < other.entry.id
}

/**
 * The `limit` pages that match what the person typed, best first: see `matchQuality` and `frecency`. Text that
 * begins a host also finds that site's front page, whether or not it was ever visited itself, with the frecency of
 * all the site's pages that begin so: the address the field completes to when the site is the best match. `shown`
 * reads a page's address and title by its id, and `front` the page whose key is a host, if the history has it.
 */
export function findPages(
  index: PageIndex,
  text: string,
  limit: number,
  now: number,
  read: { readonly shown: (id: number) => Shown | undefined; readonly front: (host: string) => Shown | undefined },
): FoundPage[] {
  const query = parseQuery(text)

  if (!query) return []
  const found = index.search(query, limit, now)

  const pages = found.pages.flatMap((item) => {
    const page = read.shown(item.id)

    return page ? [{ url: page.url, title: page.title, score: item.score, quality: item.quality }] : []
  })

  const result = (page: FoundPage): FoundPage => ({ url: page.url, title: page.title, score: page.score })
  const best = found.host ? read.shown(found.host.page) : undefined

  if (!found.host || !best) return pages.map(result)
  const front = read.front(found.host.host)
  const site = { url: front?.url ?? `${new URL(best.url).origin}/`, title: front?.title ?? "", score: found.host.score, quality: START }
  const rest = pages.filter((page) => page.url !== site.url)
  const at = rest.findIndex((page) => page.quality < START || page.score <= site.score)

  return rest.toSpliced(at < 0 ? rest.length : at, 0, site).slice(0, limit).map(result)
}
