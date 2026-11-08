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

// Sent once, when tools arrive that the catalog cannot list in full, so the model learns about `search`.
// prettier-ignore
const searchNote = `You can also look up tools that aren't listed with the global \`search(...)\` function inside \`execute\`. Before calling a tool that is not listed, find it this way. Do not guess tool names. Each result's \`path\` is the complete call expression: write it out as code, for example \`await tools.ns.tool_name({ ... })\`. Do not use it as a key such as \`tools[path]\`.

- ${searchSignature}`

const UPDATE_BUDGET = 1_000

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0)
    return "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

  const tools = catalog.namespaces.flatMap((namespace) => {
    return [CodeModeCatalog.namespaceLine(namespace), ...namespace.entries.map((entry) => entry.line)]
  })

  return `${prompt(!complete(catalog))}

${tools.join("\n")}`
}

// An update names the namespaces and tools that came or went and the signatures the model was shown that changed.
// It leaves out shown tools shifting because other namespaces came or went, which changes nothing the model relies
// on. New signatures share a fixed budget, and past it are counted.
export function update(
  previous: CodeModeCatalog.Summary,
  current: CodeModeCatalog.Summary,
  lookup: (path: string) => CodeModeCatalog.Listing | undefined,
) {
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  if (current.total === 0 || previous.total === 0) return replacement

  const namespaces = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (namespace) => namespace.name,
    (before, after) => before.description !== after.description,
  )
  // A namespace whose description changed is restated as if new.
  const added = [...namespaces.added, ...namespaces.changed.map((change) => change.current)]
  const kept = current.namespaces.flatMap((namespace) => {
    const before = previous.namespaces.find((item) => item.name === namespace.name)
    if (!before || before.description !== namespace.description) return []
    const known = new Set(before.tools)
    const present = new Set(namespace.tools)
    return [
      {
        name: namespace.name,
        added: namespace.tools.filter((path) => !known.has(path)),
        // Every signature the model was shown, whether or not it is still shown.
        changed: before.entries.flatMap((entry) => {
          const after = present.has(entry.path) ? lookup(entry.path) : undefined
          return after === undefined || after.line === entry.line ? [] : [after]
        }),
        removed: before.tools.filter((path) => !present.has(path)),
      },
    ]
  })
  const blocks = added.length + kept.filter((namespace) => namespace.added.length > 0).length
  // A catalog that lists every tool already fits its own budget, and has not introduced `search`, so nothing is cut.
  const share = complete(current) ? Infinity : blocks === 0 ? 0 : UPDATE_BUDGET / blocks
  const parts = ["The Code Mode tool catalog has changed."]
  if (added.length > 0) {
    parts.push(
      [
        "New tools are available:",
        ...added.map((namespace) => {
          const shown = fit(
            namespace.tools.flatMap((path) => lookup(path) ?? []),
            share,
          )
          return [CodeModeCatalog.namespaceLine(namespace, shown.length), ...shown.map((entry) => entry.line)].join(
            "\n",
          )
        }),
      ].join("\n"),
    )
  }
  const fresh = kept.flatMap((namespace) => {
    if (namespace.added.length === 0) return []
    const shown = fit(
      namespace.added.flatMap((path) => lookup(path) ?? []),
      share,
    )
    const rest = namespace.added.length - shown.length
    return [
      ...shown.map((entry) => entry.line),
      ...(rest === 0 ? [] : [`  - ${rest} more in \`${namespace.name}\`; search for them`]),
    ]
  })
  if (fresh.length > 0) parts.push(["New:", ...fresh].join("\n"))
  if (complete(previous) && !complete(current)) parts.push(searchNote)
  const changed = kept.flatMap((namespace) => namespace.changed.map((entry) => entry.line))
  if (changed.length > 0) parts.push(["Changed:", ...changed].join("\n"))
  const gone = kept.flatMap((namespace) => namespace.removed.map(toolExpression))
  if (gone.length > 0) parts.push(`No longer available: ${gone.join(", ")}`)
  for (const namespace of namespaces.removed)
    parts.push(`The \`${namespace.name}\` tools are no longer available and must not be used.`)
  if (parts.length === 1) return undefined
  const delta = parts.join("\n\n")
  if (delta.length < replacement.length) return delta
  return replacement
}

function complete(catalog: CodeModeCatalog.Summary) {
  return catalog.namespaces.every((namespace) => namespace.entries.length === namespace.tools.length)
}

/** The leading listings whose cost fits `budget`. */
function fit(listings: ReadonlyArray<CodeModeCatalog.Listing>, budget: number) {
  const totals: number[] = []
  for (const entry of listings) totals.push((totals.at(-1) ?? 0) + CodeModeCatalog.cost(entry.line))
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
      // Rendered once, against the inventory that produced `current`, and stored with the update.
      changed: (previous, current) =>
        update(previous, current, inventory === undefined ? () => undefined : CodeModeCatalog.lookup(inventory)),
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
