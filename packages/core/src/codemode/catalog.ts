export * as CodeModeCatalog from "./catalog.js"

import { toolExpression } from "@opencode/codemode"
import { Schema } from "effect"

export type Tool = {
  readonly type: "tool"
  readonly name: string
  readonly description: string
  /** Full signature with doc comments. Read only when a namespace is listed at that detail. */
  readonly signature: string
  /** Signature on one line, without doc comments. Read only when a namespace is listed at that detail. */
  readonly compactSignature?: string
  readonly pinned?: boolean
  /** Parameter names. Absent when the input is not a plain object. */
  readonly parameters?: { readonly required: ReadonlyArray<string>; readonly optional: ReadonlyArray<string> }
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
type Listing = typeof Listing.Type

/** One namespace's part of the catalog, built from that namespace's tools alone. */
const Section = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  count: Schema.Number,
  /** Tools listed one per line with a signature: pinned tools, and every tool when the namespace fits that way. */
  listings: Schema.Array(Listing),
  /** The other tools on one line, by name and parameters, in path order, as many as fit. */
  names: Schema.Array(Schema.String),
})
export type Section = typeof Section.Type

export const Summary = Schema.Struct({
  total: Schema.Number,
  namespaces: Schema.Array(Section),
})
export type Summary = typeof Summary.Type

export type Options = {
  /** Tokens each namespace may spend on listing its tools. */
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
const SECTION_BUDGET = 1_500
// A signature costs at least this many tokens, so a namespace with more tools than budget / this cannot list them
// all with signatures and is not rendered at that detail.
const SIGNATURE_FLOOR = 20
const LISTING_PREFIX = "  - "

type Entry = { readonly path: string; readonly tool: Tool }

// Each namespace's section depends only on its own tools, so a namespace coming, going or changing leaves the
// others as they were, and a catalog update can restate just the sections that changed. Each namespace is listed at
// the most detail that fits its budget whole: full signatures, then one-line signatures, then names with every
// parameter, then names with required parameters; past that, as many bare names as fit.
export function summarize(inventory: Inventory, options: Options = {}): Summary {
  const budget = options.budget ?? SECTION_BUDGET
  const flattened = flatten(inventory.tools)
  return {
    total: flattened.tools.length,
    namespaces: [...Map.groupBy(flattened.tools, (tool) => tool.path.split(".", 1)[0] ?? tool.path)]
      .toSorted(([left], [right]) => compare(left, right))
      .map(([name, tools]) => {
        const sorted = tools.toSorted((left, right) => compare(left.path, right.path))
        const description = flattened.namespaces.get(name)?.description
        const pinned = sorted.filter((entry) => entry.tool.pinned).map((entry) => listing(entry, entry.tool.signature))
        return {
          name,
          ...(description === undefined ? {} : { description }),
          count: tools.length,
          ...detail(
            name,
            sorted.filter((entry) => !entry.tool.pinned),
            budget,
            pinned,
          ),
        }
      }),
  }
}

function detail(namespace: string, entries: ReadonlyArray<Entry>, budget: number, pinned: ReadonlyArray<Listing>) {
  const signed = entries.length * SIGNATURE_FLOOR <= budget
  for (const signature of signed ? [(tool: Tool) => tool.signature, (tool: Tool) => tool.compactSignature] : []) {
    const listings = entries.map((entry) => listing(entry, signature(entry.tool) ?? entry.tool.signature))
    if (listings.reduce((total, item) => total + cost(item.line.length), 0) <= budget)
      return { listings: [...pinned, ...listings], names: [] }
  }
  const short = (entry: Entry) =>
    entry.path === namespace ? toolExpression(entry.path) : entry.path.slice(namespace.length + 1)
  const all = entries.map((entry) => {
    const parameters = entry.tool.parameters
    if (!parameters) return short(entry)
    return `${short(entry)}(${[...parameters.required, ...parameters.optional.map((name) => `${name}?`)].join(", ")})`
  })
  const required = entries.map((entry) => {
    const parameters = entry.tool.parameters
    if (!parameters) return short(entry)
    return `${short(entry)}(${[...parameters.required, ...(parameters.optional.length > 0 ? ["…"] : [])].join(", ")})`
  })
  const fits = (names: ReadonlyArray<string>) =>
    names.reduce((total, name) => total + cost(name.length + 2), 0) <= budget
  const names = fits(all) ? all : fits(required) ? required : fit(entries.map(short), budget)
  return { listings: [...pinned], names }
}

function listing(entry: Entry, signature: string): Listing {
  return { path: entry.path, line: `${LISTING_PREFIX}${signature}${suffix(entry.tool)}` }
}

/** The leading names whose cost fits `budget`. */
function fit(names: ReadonlyArray<string>, budget: number) {
  const totals: number[] = []
  for (const name of names) totals.push((totals.at(-1) ?? 0) + cost(name.length + 2))
  const end = totals.findIndex((total) => total > budget)
  return end === -1 ? names : names.slice(0, end)
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

/** A section's header: its name, how many tools it has and how many it lists, and its description. */
export function namespaceLine(section: Section) {
  const count = section.count === 1 ? "1 tool" : `${section.count} tools`
  const listed = section.listings.length + section.names.length
  const label = listed === section.count ? count : `${count}, ${listed} listed; search for the rest`
  return `- ${section.name} (${label})${section.description === undefined ? "" : ` // ${section.description}`}`
}

/** A section as the model reads it: its header, the tools listed with signatures, then the other tools' names. */
export function renderSection(section: Section) {
  return [
    namespaceLine(section),
    ...section.listings.map((entry) => entry.line),
    ...(section.names.length === 0 ? [] : [`${LISTING_PREFIX}${section.names.join(", ")}`]),
  ].join("\n")
}

function cost(length: number) {
  return Math.round(length / CHARACTERS_PER_TOKEN)
}
