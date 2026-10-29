export * as CodeModeCatalog from "./catalog.js"

import { createHash } from "crypto"
import { Schema } from "effect"

export type Tool = {
  readonly type: "tool"
  readonly name: string
  readonly description: string
  readonly signature: string
  readonly pinned?: boolean
}

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
  // Selection input, never rendered: pinned tools are always inlined.
  pinned: Schema.optionalKey(Schema.Boolean),
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

const SnapshotNamespace = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  listings: Schema.Array(Listing),
})

/**
 * The catalog identity carried between steps: every listing of the inventory in
 * sorted order, plus a fingerprint over the sorted `path`+`line` pairs. It never
 * holds the inline sample, so rotating that sample cannot look like a catalog
 * change, and a real change can be described as an exact incremental delta.
 */
export const Snapshot = Schema.Struct({
  total: Schema.Number,
  fingerprint: Schema.String,
  namespaces: Schema.Array(SnapshotNamespace),
})
export type Snapshot = typeof Snapshot.Type

export type Options = {
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const INLINE_BUDGET = 2_000

/** Full inventory listing, independent of how much of it will be inlined. */
export function snapshot(inventory: Inventory): Snapshot {
  const flattened = flatten(inventory.tools)
  const namespaces = [...Map.groupBy(flattened.tools, (tool) => tool.path.split(".", 1)[0] ?? tool.path)]
    .sort(([left], [right]) => {
      if (left < right) return -1
      if (left > right) return 1
      return 0
    })
    .map(([name, entries]) => {
      const description = flattened.namespaces.get(name)?.description
      return {
        name,
        ...(description === undefined ? {} : { description }),
        listings: entries.map(listing).toSorted((left, right) => {
          if (left.path < right.path) return -1
          if (left.path > right.path) return 1
          return 0
        }),
      }
    })
  return {
    total: flattened.tools.length,
    fingerprint: fingerprint(namespaces),
    namespaces,
  }
}

// Keep every namespace visible, then select full listings one per namespace per round,
// considering shorter listings first until the inline budget is exhausted.
export function select(snapshot: Snapshot, options: Options = {}): Summary {
  const budget = options.budget ?? INLINE_BUDGET
  const namespaces = snapshot.namespaces.map((namespace) => ({
    ...namespace,
    selected: new Set(namespace.listings.filter((listing) => listing.pinned === true)),
    order: rankListings(namespace.listings.filter((listing) => listing.pinned !== true)),
    index: 0,
  }))

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
      .flatMap((namespace) => namespace.listings.filter((listing) => namespace.selected.has(listing)))
      .reduce((total, listing) => total + cost(listing.line), 0)
  const active = new Set(namespaces)
  while (active.size > 0) {
    for (const namespace of active) {
      const candidate = namespace.order[namespace.index]
      if (!candidate || candidate.cost > remaining) {
        active.delete(namespace)
        continue
      }
      namespace.selected.add(candidate.listing)
      namespace.index += 1
      remaining -= candidate.cost
      if (namespace.index === namespace.order.length) active.delete(namespace)
    }
  }

  const namespaceSummaries = namespaces.map((namespace) => ({
    name: namespace.name,
    ...(namespace.description === undefined ? {} : { description: namespace.description }),
    count: namespace.listings.length,
    entries: namespace.listings.filter((listing) => namespace.selected.has(listing)),
  }))
  return {
    total: snapshot.total,
    shown: namespaceSummaries.reduce((total, namespace) => total + namespace.entries.length, 0),
    namespaces: namespaceSummaries,
  }
}

/** The rendered sample of a full inventory. */
export function summarize(inventory: Inventory, options: Options = {}): Summary {
  return select(snapshot(inventory), options)
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

function listing(entry: Omit<Tool, "name"> & { readonly path: string }): typeof Listing.Type {
  const firstLine = entry.description.split("\n", 1)[0]?.trim() ?? ""
  const description =
    firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
  const suffix = description.length === 0 ? "" : ` // ${description}`
  return {
    path: entry.path,
    line: `  - ${entry.signature}${suffix}`,
    ...(entry.pinned === true ? { pinned: true } : {}),
  }
}

function fingerprint(namespaces: ReadonlyArray<typeof SnapshotNamespace.Type>) {
  return createHash("sha256")
    .update(
      namespaces
        .flatMap((namespace) => namespace.listings.map((listing) => `${listing.path}\u0000${listing.line}`))
        .toSorted()
        .join("\n"),
    )
    .digest("hex")
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
