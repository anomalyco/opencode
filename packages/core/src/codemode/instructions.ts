export * as CodeModeInstructions from "./instructions.js"

import { searchSignature, toolExpression } from "@opencode/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

const EMPTY =
  "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

// prettier-ignore
const prompt = `# Code Mode

The tools listed below, and \`search\`, cannot be called directly: they only work as JavaScript inside the \`execute\` tool. Every other tool you have is a normal tool call: call it directly, never inside \`execute\`.

Each namespace lists its tools by name with their required parameters, and \`…\` when a tool also takes optional ones; a tool listed without parentheses takes input the list cannot summarize. Pinned tools show their full signature. Before calling a tool whose signature is not shown, get it with the global \`search(...)\` function, for example \`search({ query: "tools.ns.tool_name" })\`, and return the result; one \`execute\` can search for several tools. For a namespace that lists fewer tools than it has, find the rest the same way. Do not guess tool names or arguments. Each result's \`path\` is the complete call expression: write it out as code, for example \`await tools.ns.tool_name({ ... })\`, and call a name that is not a JavaScript identifier with brackets, as in \`tools.ns["tool-name"]({ ... })\`. Do not use a path as a key such as \`tools[path]\`.

- ${searchSignature}

## Code Mode tools (call only inside \`execute\`)`

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0) return EMPTY
  return `${prompt}

${catalog.namespaces.map(CodeModeCatalog.renderSection).join("\n")}`
}

// Sections are independent, so an update names the namespaces that came or went and restates only the sections
// that changed; the whole catalog is restated only around an empty one or when that is shorter.
export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  if (current.total === 0 || previous.total === 0) return replacement
  const sections = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (section) => section.name,
    (before, after) => CodeModeCatalog.renderSection(before) !== CodeModeCatalog.renderSection(after),
  )
  const parts = [
    ...(sections.added.length === 0
      ? []
      : [["New tool namespaces are available:", ...sections.added.map(CodeModeCatalog.renderSection)].join("\n")]),
    ...(sections.changed.length === 0
      ? []
      : [
          [
            'These namespaces changed. Lines marked "new or changed", "no longer" or "unchanged" are changes to a namespace\'s previous listing; a namespace shown without them is its whole new listing:',
            ...sections.changed.map((change) => changes(change.previous, change.current)),
          ].join("\n"),
        ]),
    ...(sections.removed.length === 0
      ? []
      : [
          `The following tool namespaces are no longer available and must not be used: ${sections.removed
            .map((section) => `\`${section.name}\``)
            .join(", ")}.`,
        ]),
  ]
  if (parts.length === 0) return replacement
  const delta = ["The Code Mode tool catalog has changed.", ...parts].join("\n\n")
  return delta.length < replacement.length ? delta : replacement
}

// One namespace's change under its new header: marked lines for the tools new, changed or gone, or its whole listing
// when that is shorter. A namespace too large to list in full can drop a name without losing the tool, so it says
// "listed" there; a tool that only moved between pinned and listed by name is not gone.
function changes(previous: CodeModeCatalog.Section, current: CodeModeCatalog.Section) {
  const names = Instructions.diffByKey(previous.names, current.names, toolName, (before, after) => before !== after)
  const pinned = Instructions.diffByKey(
    previous.pinned,
    current.pinned,
    (entry) => entry.path,
    (before, after) => before.line !== after.line,
  )
  const present = new Set([
    ...current.names.map(toolName),
    ...current.pinned.map((entry) => pinnedName(current, entry)),
  ])
  const gone = [...pinned.removed.map((entry) => pinnedName(previous, entry)), ...names.removed.map(toolName)].filter(
    (name) => !present.has(name),
  )
  const signatures = [...pinned.added, ...pinned.changed.map((change) => change.current)]
  const listed = [...names.added, ...names.changed.map((change) => change.current)]
  const capped = current.pinned.length + current.names.length < current.count
  const marked = [
    ...(signatures.length === 0 ? [] : ["  - new or changed signatures:", ...signatures.map((entry) => entry.line)]),
    ...(listed.length === 0 ? [] : [`  - new or changed: ${listed.join(", ")}`]),
    ...(gone.length === 0 ? [] : [`  - no longer ${capped ? "listed" : "available"}: ${gone.join(", ")}`]),
  ]
  const delta = [
    CodeModeCatalog.namespaceLine(current),
    ...(marked.length === 0 ? ["  - listed tools unchanged"] : marked),
  ].join("\n")
  const whole = CodeModeCatalog.renderSection(current)
  return delta.length < whole.length ? delta : whole
}

function toolName(listing: string) {
  const open = listing.indexOf("(")
  return open === -1 ? listing : listing.slice(0, open)
}

// The name a pinned tool would have if it were listed by name, so a tool moving between the two is recognized.
function pinnedName(section: CodeModeCatalog.Section, entry: { readonly path: string }) {
  return entry.path === section.name ? toolExpression(entry.path) : entry.path.slice(section.name.length + 1)
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
      changed: update,
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
