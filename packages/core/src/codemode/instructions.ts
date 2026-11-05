export * as CodeModeInstructions from "./instructions.js"

import { searchSignature } from "@opencode/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

const EMPTY =
  "No Code Mode tools are currently available. Later Code Mode catalog updates may add or remove tools. Do not call `execute` unless there is at least one available Code Mode tool."

// prettier-ignore
const prompt = `# Code Mode

The tools listed below, and \`search\`, cannot be called directly: they only work as JavaScript inside the \`execute\` tool. Every other tool you have is a normal tool call: call it directly, never inside \`execute\`.

Each namespace lists its tools by name with their required parameters, and \`…\` when a tool also takes optional ones; pinned tools show their full signature. Before calling a tool whose signature is not shown, get it with the global \`search(...)\` function, for example \`search({ query: "tools.ns.tool_name" })\`, and return the result; one \`execute\` can search for several tools. A namespace that lists fewer tools than it has finds the rest the same way. Do not guess tool names or arguments. Each result's \`path\` is the complete call expression: write it out as code, for example \`await tools.ns.tool_name({ ... })\`. Do not use it as a key such as \`tools[path]\`.

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
    ...block("New tool namespaces are available:", sections.added),
    ...block(
      "These namespaces changed; their listings supersede the previous ones:",
      sections.changed.map((change) => change.current),
    ),
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

function block(heading: string, sections: ReadonlyArray<CodeModeCatalog.Section>) {
  return sections.length === 0 ? [] : [[heading, ...sections.map(CodeModeCatalog.renderSection)].join("\n")]
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
