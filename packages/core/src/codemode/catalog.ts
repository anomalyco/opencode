export * as CodeModeCatalog from "./catalog.js"

import { Schema } from "effect"

export const Tool = Schema.Struct({
  type: Schema.Literal("tool"),
  name: Schema.String,
  description: Schema.String,
  signature: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
})
export type Tool = typeof Tool.Type

export type Namespace = {
  readonly type: "namespace"
  readonly name: string
  readonly description?: string
  readonly tools: ReadonlyArray<Tool | Namespace>
}

export type Inventory = {
  readonly tools: ReadonlyArray<Tool | Namespace>
}

const Listing = Schema.Struct({
  path: Schema.String,
  line: Schema.String,
})

const NamespaceSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  count: Schema.Number,
  entries: Schema.Array(Listing),
})

export const Summary = Schema.Struct({
  total: Schema.Number,
  shown: Schema.Number,
  namespaces: Schema.Array(NamespaceSummary),
})
export type Summary = typeof Summary.Type

export type Options = {
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const INLINE_BUDGET = 2_000

// Keep every namespace visible, then select full listings one per namespace per round,
// considering shorter listings first until the inline budget is exhausted.
export function summarize(inventory: Inventory, options: Options = {}): Summary {
  const budget = options.budget ?? INLINE_BUDGET
  const flattened = flatten(inventory.tools)
  const namespaces = [...Map.groupBy(flattened.tools, (tool) => tool.path.split(".", 1)[0] ?? tool.path)]
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
    .map(([name, namespaceEntries]) => {
      const description = flattened.namespaces.get(name)?.description
      const listings = namespaceEntries
        .map((entry) => {
          const firstLine = entry.description.split("\n", 1)[0]?.trim() ?? ""
          const description =
            firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
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
        ...(description === undefined ? {} : { description }),
        listings,
        selectionOrder: ranked.filter((candidate) => !pinned.has(candidate.listing)),
        selectedListings: pinned,
        selectionIndex: 0,
      }
    })

  const active = new Set(namespaces)
  // TODO: Bound namespace discovery once large namespace inventories and descriptions can no longer stay inline.
  let remaining =
    budget -
    namespaces.reduce(
      (total, namespace) =>
        total +
        cost(
          namespaceLine({
            name: namespace.name,
            ...(namespace.description === undefined ? {} : { description: namespace.description }),
            count: namespace.listings.length,
            entries: [],
          }),
        ),
      0,
    ) -
    namespaces
      .flatMap((namespace) => namespace.listings.filter((listing) => namespace.selectedListings.has(listing)))
      .reduce((total, listing) => total + cost(listing.line), 0)
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
    ...(namespace.description === undefined ? {} : { description: namespace.description }),
    count: namespace.listings.length,
    entries: namespace.listings.filter((listing) => namespace.selectedListings.has(listing)),
  }))
  return {
    total: flattened.tools.length,
    shown: namespaceSummaries.reduce((total, namespace) => total + namespace.entries.length, 0),
    namespaces: namespaceSummaries,
  }
}

function flatten(entries: ReadonlyArray<Tool | Namespace>, path: ReadonlyArray<string> = []) {
  const tools: Array<Omit<Tool, "name"> & { readonly path: string }> = []
  const namespaces = new Map<string, Namespace>()
  for (const entry of entries) {
    if (entry.type === "tool") {
      tools.push({
        type: "tool",
        path: [...path, entry.name].join("."),
        description: entry.description,
        signature: entry.signature,
        ...(entry.pinned === undefined ? {} : { pinned: entry.pinned }),
      })
      continue
    }
    const next = [...path, entry.name]
    namespaces.set(next.join("."), entry)
    const nested = flatten(entry.tools, next)
    tools.push(...nested.tools)
    for (const [name, namespace] of nested.namespaces) namespaces.set(name, namespace)
  }
  return { tools, namespaces }
}

export function namespaceLine(namespace: typeof NamespaceSummary.Type) {
  const count = namespace.count === 1 ? "1 tool" : `${namespace.count} tools`
  const label =
    namespace.entries.length === namespace.count
      ? count
      : namespace.entries.length === 0
        ? `${count}, none shown`
        : `${count}, ${namespace.entries.length} shown`
  return `- ${namespace.name} (${label})${namespace.description === undefined ? "" : ` // ${namespace.description}`}`
}

function rankListings(listings: ReadonlyArray<typeof Listing.Type>) {
  return listings
    .map((listing) => ({ listing, cost: cost(listing.line) }))
    .toSorted((left, right) => {
      if (left.cost !== right.cost) return left.cost - right.cost
      if (left.listing.path < right.listing.path) return -1
      if (left.listing.path > right.listing.path) return 1
      return 0
    })
}

function cost(text: string) {
  return Math.round(text.length / CHARACTERS_PER_TOKEN)
}
