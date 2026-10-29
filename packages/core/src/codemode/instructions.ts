export * as CodeModeInstructions from "./instructions.js"

import { searchSignature, toolExpression } from "@opencode/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

// prettier-ignore
const prompt = (hasMoreTools: boolean) => `# Code Mode

The tools listed below${hasMoreTools ? ", and \`search\`," : ""} cannot be called directly: they only work as JavaScript inside the \`execute\` tool. Every other tool you have is a normal tool call: call it directly, never inside \`execute\`.

${hasMoreTools ? `The catalog is partial. Before calling a tool that is not listed below, find it with the global \`search(...)\` function. Do not guess tool names. Each result's \`path\` is the complete call expression: write it out as code, for example \`await tools.ns.tool_name({ ... })\`. Do not use it as a key such as \`tools[path]\`.

- ${searchSignature}` : "The catalog is complete. Do not guess tool names."}

## Code Mode tools (call only inside \`execute\`)`

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0)
    return "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

  const tools = catalog.namespaces.flatMap((namespace) => {
    return [CodeModeCatalog.namespaceLine(namespace), ...namespace.entries.map((entry) => entry.line)]
  })

  return `${prompt(catalog.shown < catalog.total)}

${tools.join("\n")}`
}

/**
 * Describes what moved between two full inventories. The persisted identity holds
 * every listing rather than the inline sample, so a partial catalog needs no
 * whole-block restatement when the sample rotates: only the difference is sent.
 */
export function update(
  previous: CodeModeCatalog.Snapshot,
  current: CodeModeCatalog.Snapshot,
  options: CodeModeCatalog.Options = {},
) {
  const selected = CodeModeCatalog.select(current, options)
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(selected)}`
  // An emptied catalog restates the no-tools notice the model must obey.
  if (current.total === 0) return replacement
  const delta = incremental(previous, current, selected, selected.shown === selected.total)
  if (delta.length === 0) return replacement
  if (delta.length < replacement.length) return delta
  return replacement
}

const listings = (catalog: CodeModeCatalog.Snapshot) =>
  catalog.namespaces.flatMap((namespace) => namespace.listings)

function incremental(
  previous: CodeModeCatalog.Snapshot,
  current: CodeModeCatalog.Snapshot,
  selected: CodeModeCatalog.Summary,
  complete: boolean,
) {
  const tools = Instructions.diffByKey(
    listings(previous),
    listings(current),
    (listing) => listing.path,
    (before, after) => before.line !== after.line,
  )
  const namespaces = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (namespace) => namespace.name,
    (before, after) => before.listings.length !== after.listings.length,
  )
  const descriptions = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (namespace) => namespace.name,
    (before, after) => before.description !== after.description,
  )

  const parts: Array<string> = []
  if (namespaces.added.length > 0) {
    parts.push(
      `New tool namespaces are available: ${namespaces.added
        .map((namespace) => `\`${namespace.name}\` (${namespace.listings.length} tools)`)
        .join(", ")}.`,
    )
  }
  if (namespaces.changed.length > 0) {
    parts.push(
      `The following namespace inventories changed; search them again before relying on previous results: ${namespaces.changed
        .map((change) => `\`${change.current.name}\` now has ${change.current.listings.length} tools`)
        .join(", ")}.`,
    )
  }
  if (descriptions.changed.length > 0) {
    // Restate the same namespace lines the catalog renders, so the shown counts stay true.
    const lines = new Map(selected.namespaces.map((namespace) => [namespace.name, namespace]))
    parts.push(
      [
        "The following namespace summaries supersede the previously listed ones:",
        ...descriptions.changed.map((change) => CodeModeCatalog.namespaceLine(lines.get(change.current.name)!)),
      ].join("\n"),
    )
  }
  if (tools.added.length > 0) {
    // A partial catalog already namespaces more than it inlines, so a new namespace is
    // announced by name and found through search. Its restated listings could dwarf that line.
    const fresh = new Set(namespaces.added.map((namespace) => namespace.name))
    const listed = tools.added.filter(
      (entry) => complete || !fresh.has(entry.path.split(".", 1)[0] ?? entry.path),
    )
    if (listed.length > 0) {
      parts.push(
        ["New tools are available in addition to those previously listed:", ...listed.map((entry) => entry.line)].join(
          "\n",
        ),
      )
    }
  }
  if (tools.changed.length > 0) {
    parts.push(
      [
        "Changed tool listings supersede the previously listed ones:",
        ...tools.changed.map((change) => change.current.line),
      ].join("\n"),
    )
  }
  if (tools.removed.length > 0) {
    parts.push(
      `The following tools are no longer available and must not be called: ${tools.removed
        .map((entry) => toolExpression(entry.path))
        .join(", ")}.`,
    )
  }
  if (parts.length === 0) return ""
  return ["The Code Mode tool catalog has changed.", ...parts].join("\n\n")
}

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Snapshot)

export const make = (inventory?: CodeModeCatalog.Inventory, options: CodeModeCatalog.Options = {}): Instructions.List => {
  const catalog = inventory === undefined ? Instructions.removed : CodeModeCatalog.snapshot(inventory)
  return Instructions.make({
    key,
    codec,
    read: Effect.succeed(catalog),
    render: {
      initial: (catalog) => render(CodeModeCatalog.select(catalog, options)),
      changed: (previous, current) => update(previous, current, options),
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
