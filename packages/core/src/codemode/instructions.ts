export * as CodeModeInstructions from "./instructions"

import { searchSignature, toolExpression } from "@opencode-ai/codemode"
import { Effect, Schema } from "effect"
import { Instructions } from "../instructions/index"
import { CodeModeCatalog } from "./catalog"

// prettier-ignore
const prompt = (hasMoreTools: boolean) => `Run JavaScript to orchestrate tool calls and compose their results. Imports, direct filesystem access, and timers are unavailable. Do not use \`fetch\`; all external access goes through \`tools\`.

Prefer an explicit \`return\`; if omitted, the final top-level expression becomes the result. Await tool calls before returning; any calls still pending when execution ends are interrupted. Run independent calls concurrently with \`Promise.all\`.

Do not infer or normalize tool names; use only the exact signatures shown below${hasMoreTools ? " or returned by `search`" : ""}, preserving bracket notation such as \`tools.<namespace>["tool-name"](input)\`.${hasMoreTools ? `

## Search

Only some tool signatures are shown. Use \`search\` to discover exact paths and signatures for additional tools:

- ${searchSignature}` : ""}

## Available tools`

export function render(catalog: CodeModeCatalog.Summary) {
  if (catalog.total === 0) return "No tools are currently available."

  const tools = catalog.namespaces.flatMap((namespace) => {
    const count = namespace.count === 1 ? "1 tool" : `${namespace.count} tools`
    const label =
      namespace.entries.length === namespace.count
        ? count
        : namespace.entries.length === 0
          ? `${count}, none shown`
          : `${count}, ${namespace.entries.length} shown`
    return [`- ${namespace.name} (${label})`, ...namespace.entries.map((entry) => entry.line)]
  })

  return `${prompt(catalog.shown < catalog.total)}

${tools.join("\n")}`
}

export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const full = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  const previousComplete = previous.shown === previous.total
  const currentComplete = current.shown === current.total
  if (previousComplete !== currentComplete) return full

  const diff = Instructions.diffByKey(
    previous.namespaces.flatMap((namespace) => namespace.entries),
    current.namespaces.flatMap((namespace) => namespace.entries),
    (entry) => entry.path,
    (before, after) => before.line !== after.line,
  )
  const entriesChanged = diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0

  if (!currentComplete) {
    if (entriesChanged) return full
    const namespaces = Instructions.diffByKey(
      previous.namespaces,
      current.namespaces,
      (namespace) => namespace.name,
      (before, after) => before.count !== after.count,
    )
    const changed = namespaces.added.length > 0 || namespaces.removed.length > 0 || namespaces.changed.length > 0
    if (!changed) return full

    const parts = ["The Code Mode tool catalog has changed."]
    if (namespaces.added.length > 0) {
      parts.push(
        `New tool namespaces are available: ${namespaces.added
          .map((namespace) => `\`${namespace.name}\` (${namespace.count} tools)`)
          .join(", ")}.`,
      )
    }
    if (namespaces.changed.length > 0) {
      parts.push(
        `The following namespace inventories changed; search them again before relying on previous results: ${namespaces.changed
          .map((change) => `\`${change.current.name}\` now has ${change.current.count} tools`)
          .join(", ")}.`,
      )
    }
    if (namespaces.removed.length > 0) {
      parts.push(
        `The following tool namespaces are no longer available and must not be used: ${namespaces.removed
          .map((namespace) => `\`${namespace.name}\``)
          .join(", ")}.`,
      )
    }
    const delta = parts.join("\n\n")
    if (delta.length < full.length) return delta
    return full
  }

  if (!entriesChanged) return full
  const parts = ["The Code Mode tool catalog has changed."]
  if (diff.added.length > 0) {
    parts.push(
      [
        "New tools are available in addition to those previously listed:",
        ...diff.added.map((entry) => entry.line),
      ].join("\n"),
    )
  }
  if (diff.changed.length > 0) {
    parts.push(
      [
        "Changed tool listings supersede the previously listed ones:",
        ...diff.changed.map((change) => change.current.line),
      ].join("\n"),
    )
  }
  if (diff.removed.length > 0) {
    parts.push(
      `The following tools are no longer available and must not be called: ${diff.removed
        .map((entry) => toolExpression(entry.path))
        .join(", ")}.`,
    )
  }
  const delta = parts.join("\n\n")
  if (delta.length < full.length) return delta
  return full
}

const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Summary)

export const make = (entries?: ReadonlyArray<CodeModeCatalog.Entry>): Instructions.Instructions => {
  const catalog = CodeModeCatalog.summarize(entries ?? [])
  return Instructions.make({
    key,
    codec,
    read: Effect.succeed(catalog.total === 0 ? Instructions.removed : catalog),
    render: {
      initial: render,
      changed: update,
      removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
    },
  })
}
