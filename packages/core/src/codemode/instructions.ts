export * as CodeModeInstructions from "./instructions.js"

import { searchSignature, toolExpression } from "@opencode/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

const UPDATE_BUDGET = 1_000

const EMPTY =
  "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

// prettier-ignore
const prompt = `# Code Mode

The tools listed below, and \`search\`, cannot be called directly: they only work as JavaScript inside the \`execute\` tool. Every other tool you have is a normal tool call: call it directly, never inside \`execute\`.

A group may show only some of its tools. Before calling a tool whose signature is not shown, get it with the global \`search(...)\` function, for example \`search({ query: "tools.ns.tool_name" })\`, and return the result; one \`execute\` can search for several tools. Do not guess tool names or arguments. Each result's \`path\` is the complete call expression: write it out as code, for example \`await tools.ns.tool_name({ ... })\`, and call a name that is not a JavaScript identifier with brackets, as in \`tools.ns["tool-name"]({ ... })\`. Do not use a path as a key such as \`tools[path]\`.

- ${searchSignature}

## Code Mode tools (call only inside \`execute\`)`

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0) return EMPTY
  return `${prompt}

${catalog.namespaces.map(CodeModeCatalog.renderSection).join("\n")}`
}

// An update tells the model about tools it does not know of: groups and tools that came, signatures it was shown
// that changed, and tools that went. Shown tools shifting because other groups came or went, and pinning, change
// nothing the model relies on and are left out. New signatures share a fixed budget; the whole catalog is restated
// only around an empty one or when that is shorter.
export function update(
  previous: CodeModeCatalog.Summary,
  current: CodeModeCatalog.Summary,
  lookup: (path: string) => CodeModeCatalog.Listing | undefined,
) {
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  if (current.total === 0 || previous.total === 0) return replacement
  const sections = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (section) => section.name,
    () => true,
  )
  const kept = sections.changed.map((change) => changes(change.previous, change.current))
  const blocks = sections.added.length + kept.filter((change) => change.added.length > 0).length
  const share = blocks === 0 ? 0 : UPDATE_BUDGET / blocks
  const added = kept.flatMap((change) => {
    if (change.added.length === 0) return []
    const shown = fit(listings(change.added, lookup), share)
    const rest = change.added.length - shown.length
    return [
      ...shown.map((entry) => entry.line),
      ...(rest === 0 ? [] : [`  - ${rest} more in \`${change.name}\`; search for them`]),
    ]
  })
  const changed = kept.flatMap((change) => change.changed.map((entry) => entry.line))
  const gone = kept.flatMap((change) => change.removed.map(toolExpression))
  const parts = [
    ...(sections.added.length === 0
      ? []
      : [
          [
            "New tools are available:",
            ...sections.added.map((section) => {
              const shown = fit(listings(section.tools, lookup), share)
              return [CodeModeCatalog.namespaceLine(section, shown.length), ...shown.map((entry) => entry.line)].join(
                "\n",
              )
            }),
          ].join("\n"),
        ]),
    ...(added.length === 0 ? [] : [["New:", ...added].join("\n")]),
    ...(changed.length === 0 ? [] : [["Changed:", ...changed].join("\n")]),
    ...(gone.length === 0 ? [] : [`No longer available: ${gone.join(", ")}`]),
    ...sections.removed.map((section) => `The \`${section.name}\` tools are no longer available and must not be used.`),
  ]
  if (parts.length === 0) return undefined
  const delta = ["The Code Mode tool catalog has changed.", ...parts].join("\n\n")
  return delta.length < replacement.length ? delta : replacement
}

// What changed in a group the model already knew: its new tools, the shown
// signatures that differ from the ones shown before, and the tools that went.
function changes(previous: CodeModeCatalog.Section, current: CodeModeCatalog.Section) {
  const known = new Set(previous.tools)
  const present = new Set(current.tools)
  const shown = new Map(previous.listings.map((entry) => [entry.path, entry]))
  return {
    name: current.name,
    added: current.tools.filter((path) => !known.has(path)),
    changed: current.listings.filter((entry) => {
      const before = shown.get(entry.path)
      return before !== undefined && before.line !== entry.line
    }),
    removed: previous.tools.filter((path) => !present.has(path)),
  }
}

function listings(paths: ReadonlyArray<string>, lookup: (path: string) => CodeModeCatalog.Listing | undefined) {
  return paths.flatMap((path) => lookup(path) ?? [])
}

/** The leading listings whose cost fits `budget`. */
function fit(listings: ReadonlyArray<CodeModeCatalog.Listing>, budget: number) {
  const totals: number[] = []
  for (const entry of listings) totals.push((totals.at(-1) ?? 0) + CodeModeCatalog.cost(entry.line.length))
  const end = totals.findIndex((total) => total > budget)
  return end === -1 ? listings : listings.slice(0, end)
}

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Summary)

export const make = (inventory?: CodeModeCatalog.Inventory): Instructions.List => {
  const catalog = inventory === undefined ? Instructions.removed : CodeModeCatalog.summarize(inventory)
  return Instructions.make({
    key,
    codec,
    read: Effect.succeed(catalog),
    render: {
      initial: render,
      // Update text is rendered once, against the inventory that produced `current`, and stored.
      changed: (previous, current) =>
        update(previous, current, inventory === undefined ? () => undefined : CodeModeCatalog.lookup(inventory)),
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
