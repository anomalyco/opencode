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

/** One group's part of the catalog. */
const Section = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** Every tool's path, so an update can tell a new tool from one that was not shown. */
  tools: Schema.Array(Schema.String),
  /** The tools shown with a signature: pinned tools first, then the others in path order. */
  listings: Schema.Array(Listing),
})
export type Section = typeof Section.Type

export const Summary = Schema.Struct({
  total: Schema.Number,
  namespaces: Schema.Array(Section),
})
export type Summary = typeof Summary.Type

export type Options = {
  /** Tokens the catalog may spend on signatures. */
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const BUDGET = 2_000
const LISTING_PREFIX = "  - "

type Entry = { readonly path: string; readonly tool: Tool }
type Group = { readonly name: string; readonly entries: ReadonlyArray<Entry> }

// Pinned tools always show. The groups then take turns showing their next tool by path while it fits, so space one
// group cannot use goes to the others. It depends only on the tools, so the catalog changes only when they do, and
// only the signatures it shows are rendered.
export function summarize(inventory: Inventory, options: Options = {}): Summary {
  const flattened = flatten(inventory.tools)
  const groups = [...Map.groupBy(flattened.tools, (tool) => tool.path.split(".", 1)[0] ?? tool.path)]
    .toSorted(([left], [right]) => compare(left, right))
    .map(([name, tools]) => ({ name, entries: tools.toSorted((left, right) => compare(left.path, right.path)) }))
  const pinned = new Map(
    groups.map((group) => [group.name, group.entries.filter((entry) => entry.tool.pinned).map(listing)]),
  )
  const room =
    (options.budget ?? BUDGET) - [...pinned.values()].flat().reduce((total, item) => total + cost(item.line.length), 0)
  const shown = share(
    groups.map((group) => ({ name: group.name, entries: group.entries.filter((entry) => !entry.tool.pinned) })),
    room,
  )
  return {
    total: flattened.tools.length,
    namespaces: groups.map((group) => {
      const description = flattened.namespaces.get(group.name)?.description
      return {
        name: group.name,
        ...(description === undefined ? {} : { description }),
        tools: group.entries.map((entry) => entry.path),
        listings: [...(pinned.get(group.name) ?? []), ...(shown.get(group.name) ?? [])],
      }
    }),
  }
}

function share(groups: ReadonlyArray<Group>, room: number) {
  const shown = new Map(groups.map((group) => [group.name, [] as Listing[]]))
  const open = new Set(groups)
  let left = room
  while (open.size > 0)
    for (const group of open) {
      const listings = shown.get(group.name) ?? []
      const entry = group.entries[listings.length]
      const next = entry === undefined ? undefined : listing(entry)
      if (next === undefined || cost(next.line.length) > left) {
        open.delete(group)
        continue
      }
      left -= cost(next.line.length)
      listings.push(next)
    }
  return shown
}

/** Looks up any tool's listing as the catalog would show it. */
export function lookup(inventory: Inventory) {
  const entries = new Map(flatten(inventory.tools).tools.map((entry) => [entry.path, entry]))
  return (path: string) => {
    const entry = entries.get(path)
    return entry === undefined ? undefined : listing(entry)
  }
}

function listing(entry: Entry): Listing {
  return { path: entry.path, line: `${LISTING_PREFIX}${entry.tool.signature}${suffix(entry.tool)}` }
}

function suffix(tool: Tool) {
  const firstLine = tool.description.split("\n", 1)[0]?.trim() ?? ""
  const description =
    firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
  return description.length === 0 ? "" : ` // ${description}`
}

function compare(left: string, right: string) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
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

/** A section's header: its name, how many tools it has and how many it shows, and its description. */
export function namespaceLine(section: Section, shown = section.listings.length) {
  const count = section.tools.length === 1 ? "1 tool" : `${section.tools.length} tools`
  const label = shown === section.tools.length ? count : `${count}, ${shown} shown`
  return `- ${section.name} (${label})${section.description === undefined ? "" : ` // ${section.description}`}`
}

/** A section as the model reads it: its header, then the tools it shows. */
export function renderSection(section: Section) {
  return [namespaceLine(section), ...section.listings.map((entry) => entry.line)].join("\n")
}

export function cost(length: number) {
  return Math.round(length / CHARACTERS_PER_TOKEN)
}
