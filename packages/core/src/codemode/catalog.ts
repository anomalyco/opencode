export * as CodeModeCatalog from "./catalog.js"

import { Schema } from "effect"

export type Tool = {
  readonly type: "tool"
  readonly name: string
  readonly description: string
  /** Read only for pinned tools; listing a tool by name needs no signature. */
  readonly signature: string
  readonly pinned?: boolean
  /** Required parameter names, then `…` when the tool also takes optional ones. Absent when unknown. */
  readonly parameters?: ReadonlyArray<string>
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

/** One namespace's part of the catalog, built from that namespace's tools alone. */
const Section = Schema.Struct({
  name: Schema.String,
  description: Schema.optionalKey(Schema.String),
  count: Schema.Number,
  /** Pinned tools, with full signatures. */
  pinned: Schema.Array(Listing),
  /** The other tools by name and required parameters, in path order, as many as fit the section budget. */
  names: Schema.Array(Schema.String),
})
export type Section = typeof Section.Type

export const Summary = Schema.Struct({
  total: Schema.Number,
  namespaces: Schema.Array(Section),
})
export type Summary = typeof Summary.Type

export type Options = {
  /** Tokens each namespace may spend on names. */
  readonly budget?: number
}

const DESCRIPTION_LIMIT = 120
const CHARACTERS_PER_TOKEN = 4
// Enough for every tool of a typical MCP server; a larger one lists what fits and the rest is found with search.
const SECTION_BUDGET = 1_500
const LISTING_PREFIX = "  - "

// Each namespace's section depends only on its own tools, so a namespace coming, going or changing leaves the
// others as they were, and a catalog update can restate just the sections that changed.
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
        return {
          name,
          ...(description === undefined ? {} : { description }),
          count: tools.length,
          pinned: sorted
            .filter((entry) => entry.tool.pinned)
            .map((entry) => ({
              path: entry.path,
              line: `${LISTING_PREFIX}${entry.tool.signature}${suffix(entry.tool)}`,
            })),
          names: fit(
            sorted
              .filter((entry) => !entry.tool.pinned)
              .map((entry) => {
                const short = entry.path.slice(name.length + 1)
                return entry.tool.parameters ? `${short}(${entry.tool.parameters.join(", ")})` : short
              }),
            budget,
          ),
        }
      }),
  }
}

/** The leading names whose cost fits `budget`. */
function fit(names: ReadonlyArray<string>, budget: number) {
  const shown: string[] = []
  let remaining = budget
  for (const name of names) {
    const price = cost(name.length + 2)
    if (price > remaining) break
    shown.push(name)
    remaining -= price
  }
  return shown
}

function suffix(tool: Tool) {
  const firstLine = tool.description.split("\n", 1)[0]?.trim() ?? ""
  const description =
    firstLine.length > DESCRIPTION_LIMIT ? firstLine.slice(0, DESCRIPTION_LIMIT - 3) + "..." : firstLine
  return description.length === 0 ? "" : ` // ${description}`
}

function compare(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
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
  const listed = section.pinned.length + section.names.length
  const label = listed === section.count ? count : `${count}, ${listed} listed; search for the rest`
  return `- ${section.name} (${label})${section.description === undefined ? "" : ` // ${section.description}`}`
}

/** A section as the model reads it: its header, its pinned signatures, then the other tools' names. */
export function renderSection(section: Section) {
  return [
    namespaceLine(section),
    ...section.pinned.map((entry) => entry.line),
    ...(section.names.length === 0 ? [] : [`${LISTING_PREFIX}${section.names.join(", ")}`]),
  ].join("\n")
}

function cost(length: number) {
  return Math.round(length / CHARACTERS_PER_TOKEN)
}
