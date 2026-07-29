export * as CodeModeCatalog from "./catalog"

import { Schema } from "effect"

export const Entry = Schema.Struct({
  path: Schema.String,
  description: Schema.String,
  signature: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
})
export type Entry = typeof Entry.Type

const Listing = Schema.Struct({
  path: Schema.String,
  line: Schema.String,
})

const Namespace = Schema.Struct({
  name: Schema.String,
  count: Schema.Number,
  entries: Schema.Array(Listing),
})

export const Summary = Schema.Struct({
  total: Schema.Number,
  shown: Schema.Number,
  namespaces: Schema.Array(Namespace),
})
export type Summary = typeof Summary.Type

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const INLINE_BUDGET = 2_000

// Keep every namespace searchable, then select full listings one per namespace per round,
// considering shorter listings first until the inline budget is exhausted.
export function summarize(entries: ReadonlyArray<Entry>, budget = INLINE_BUDGET): Summary {
  const namespaces = [...Map.groupBy(entries, (entry) => entry.path.split(".", 1)[0] ?? entry.path)]
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
    .map(([name, namespaceEntries]) => {
      const listings = namespaceEntries
        .map((entry) => {
          const firstLine = entry.description.split("\n", 1)[0]?.trim() ?? ""
          const description =
            firstLine.length > DESCRIPTION_LIMIT
              ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..."
              : firstLine
          const suffix = description.length === 0 ? "" : ` // ${description}`
          return { path: entry.path, line: `  - ${entry.signature}${suffix}` }
        })
        .toSorted((left, right) => {
          if (left.path < right.path) return -1
          if (left.path > right.path) return 1
          return 0
        })
      const ranked = rankListings(listings)
      const pinned = new Set(
        namespaceEntries
          .filter((entry) => entry.pinned)
          .map((entry) => listings.find((listing) => listing.path === entry.path))
          .filter((listing) => listing !== undefined),
      )
      return {
        name,
        listings,
        selectionOrder: ranked.filter((candidate) => !pinned.has(candidate.listing)),
        selectedListings: pinned,
        selectionIndex: 0,
      }
    })

  const active = new Set(namespaces)
  let remaining =
    budget -
    namespaces
      .flatMap((namespace) => namespace.listings.filter((listing) => namespace.selectedListings.has(listing)))
      .reduce((total, listing) => total + Math.round(listing.line.length / CHARACTERS_PER_TOKEN), 0)
  while (active.size > 0) {
    for (const namespace of active) {
      const candidate = namespace.selectionOrder[namespace.selectionIndex]
      if (!candidate || candidate.cost > remaining) {
        active.delete(namespace)
        continue
      }
      namespace.selectedListings.add(candidate.listing)
      namespace.selectionIndex += 1
      remaining -= candidate.cost
      if (namespace.selectionIndex === namespace.selectionOrder.length) active.delete(namespace)
    }
  }

  const namespaceSummaries = namespaces.map((namespace) => ({
    name: namespace.name,
    count: namespace.listings.length,
    entries: namespace.listings.filter((listing) => namespace.selectedListings.has(listing)),
  }))
  return {
    total: entries.length,
    shown: namespaceSummaries.reduce((total, namespace) => total + namespace.entries.length, 0),
    namespaces: namespaceSummaries,
  }
}

function rankListings(listings: ReadonlyArray<typeof Listing.Type>) {
  return listings
    .map((listing) => ({ listing, cost: Math.round(listing.line.length / CHARACTERS_PER_TOKEN) }))
    .toSorted((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost
      if (left.listing.path < right.listing.path) return -1
      if (left.listing.path > right.listing.path) return 1
      return 0
    })
}
