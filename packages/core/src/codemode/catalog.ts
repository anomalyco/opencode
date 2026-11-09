export * as CodeModeCatalog from "./catalog.js"

import { Schema } from "effect"

export type Tool = {
  readonly type: "tool"
  readonly name: string
  readonly description: string
  /** Read only for the tools the catalog shows. */
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
})
export type Listing = typeof Listing.Type

const NamespaceSummary = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** Every tool's path, so an update can tell a new tool from one that was not shown. */
  tools: Schema.Array(Schema.String),
  entries: Schema.Array(Listing),
})
export type NamespaceSummary = typeof NamespaceSummary.Type

export const Summary = Schema.Struct({
  total: Schema.Number,
  namespaces: Schema.Array(NamespaceSummary),
})
export type Summary = typeof Summary.Type

export type Options = {
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const INLINE_BUDGET = 2_000

// Keep every namespace visible, then select full listings one per namespace per round, in path order, until the
// inline budget is exhausted. The selection depends only on the tools, and only selected signatures are rendered.
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
      const sorted = namespaceEntries.toSorted((left, right) => {
        if (left.path < right.path) return -1
        if (left.path > right.path) return 1
        return 0
      })
      return {
        name,
        ...(description === undefined ? {} : { description }),
        tools: sorted.map((entry) => entry.path),
        selectionOrder: sorted.filter((entry) => !entry.tool.pinned),
        selectedListings: sorted.filter((entry) => entry.tool.pinned).map(listing),
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
            tools: namespace.tools,
            entries: [],
          }),
        ),
      0,
    ) -
    namespaces
      .flatMap((namespace) => namespace.selectedListings)
      .reduce((total, listing) => total + cost(listing.line), 0)
  while (active.size > 0) {
    for (const namespace of active) {
      const entry = namespace.selectionOrder[namespace.selectionIndex]
      const candidate = entry && listing(entry)
      if (!candidate || cost(candidate.line) > remaining) {
        active.delete(namespace)
        continue
      }
      namespace.selectedListings.push(candidate)
      namespace.selectionIndex += 1
      remaining -= cost(candidate.line)
      if (namespace.selectionIndex === namespace.selectionOrder.length) active.delete(namespace)
    }
  }

  return {
    total: flattened.tools.length,
    namespaces: namespaces.map((namespace) => ({
      name: namespace.name,
      ...(namespace.description === undefined ? {} : { description: namespace.description }),
      tools: namespace.tools,
      entries: namespace.selectedListings,
    })),
  }
}

/** Looks up any tool's listing as the catalog would show it. */
export function lookup(inventory: Inventory) {
  const tools = new Map(flatten(inventory.tools).tools.map((entry) => [entry.path, entry]))
  return (path: string) => {
    const entry = tools.get(path)
    return entry === undefined ? undefined : listing(entry)
  }
}

function listing(entry: { readonly path: string; readonly tool: Tool }) {
  const firstLine = entry.tool.description.split("\n", 1)[0]?.trim() ?? ""
  const description =
    firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
  const suffix = description.length === 0 ? "" : ` // ${description}`
  return { path: entry.path, line: `  - ${entry.tool.signature}${suffix}` }
}

function flatten(entries: ReadonlyArray<Tool | Namespace>, path: ReadonlyArray<string> = []) {
  const tools: Array<{ readonly path: string; readonly tool: Tool }> = []
  const namespaces = new Map<string, Namespace>()
  for (const entry of entries) {
    if (entry.type === "tool") {
      tools.push({ path: [...path, entry.name].join("."), tool: entry })
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

export function namespaceLine(namespace: NamespaceSummary, shown = namespace.entries.length) {
  const count = namespace.tools.length === 1 ? "1 tool" : `${namespace.tools.length} tools`
  const label =
    shown === namespace.tools.length ? count : shown === 0 ? `${count}, none shown` : `${count}, ${shown} shown`
  return `- ${namespace.name} (${label})${namespace.description === undefined ? "" : ` // ${namespace.description}`}`
}

export function cost(text: string) {
  return Math.round(text.length / CHARACTERS_PER_TOKEN)
}
