export * as CodeModeInstructions from "./instructions.js"

import { searchSignature, toolExpression } from "@opencode/codemode"
import { Effect, Option, Schema } from "effect"
import { Instructions } from "../instructions/index.js"
import { CodeModeCatalog } from "./catalog.js"

const pathRule =
  "Each result's `path` is the complete call expression: write it out as code, for example `await tools.ns.tool_name({ ... })`. Do not use it as a key such as `tools[path]`."

// prettier-ignore
const prompt = (hasMoreTools: boolean) => `# Code Mode

The tools listed below${hasMoreTools ? ", and \`search\`," : ""} cannot be called directly: they only work as JavaScript inside the \`execute\` tool. Every other tool you have is a normal tool call: call it directly, never inside \`execute\`.

${hasMoreTools ? `The catalog is partial. Before calling a tool that is not listed below, find it with the global \`search(...)\` function. Do not guess tool names. ${pathRule}

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

// Tells the model what changed since the catalog it last saw. The session's catalog keeps the tools it listed
// (see `CodeModeCatalog.summarize`), so a namespace or tool coming or going renders as a few lines; the whole
// catalog is restated only when a namespace's guidance changes or the delta would be longer.
export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const replacement = `The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.

${render(current)}`
  if (current.total === 0 || previous.total === 0) return replacement

  const namespaces = Instructions.diffByKey(
    previous.namespaces,
    current.namespaces,
    (namespace) => namespace.name,
    (before, after) => before.count !== after.count || before.description !== after.description,
  )
  if (namespaces.changed.some((change) => change.previous.description !== change.current.description)) return replacement
  const kept = new Set(current.namespaces.map((namespace) => namespace.name))
  const entries = Instructions.diffByKey(
    previous.namespaces.filter((namespace) => kept.has(namespace.name)).flatMap((namespace) => namespace.entries),
    current.namespaces.flatMap((namespace) => namespace.entries),
    (entry) => entry.path,
    (before, after) => before.line !== after.line,
  )
  const added = new Set(namespaces.added.map((namespace) => namespace.name))
  const complete = current.shown === current.total
  const wasComplete = previous.shown === previous.total

  const parts = [
    ...(wasComplete && !complete
      ? [
          `The catalog is now partial. Before calling a tool that is not listed, find it with the global \`search(...)\` function. Do not guess tool names. ${pathRule}\n\n- ${searchSignature}`,
        ]
      : []),
    ...(!wasComplete && complete ? ["The catalog is now complete: every Code Mode tool is listed. Do not guess tool names."] : []),
    ...(namespaces.added.length === 0
      ? []
      : [
          [
            "New tool namespaces are available:",
            ...namespaces.added.flatMap((namespace) => [
              CodeModeCatalog.namespaceLine(namespace),
              ...namespace.entries.map((entry) => entry.line),
            ]),
          ].join("\n"),
        ]),
    ...listed(
      "New tools are available in addition to those previously listed:",
      entries.added.filter((entry) => !added.has(entry.path.split(".", 1)[0]!)),
    ),
    ...listed(
      "Changed tool listings supersede the previously listed ones:",
      entries.changed.map((change) => change.current),
    ),
    // A complete catalog lists every change; only a partial one can hide changed tools.
    ...(complete || namespaces.changed.length === 0
      ? []
      : [
          `The following namespace inventories changed; search them again before relying on previous results: ${namespaces.changed
            .map((change) => `\`${change.current.name}\` now has ${change.current.count} tools`)
            .join(", ")}.`,
        ]),
    ...(entries.removed.length === 0
      ? []
      : [
          complete
            ? `The following tools are no longer available and must not be called: ${expressions(entries.removed)}.`
            : `The following tools are no longer listed: ${expressions(entries.removed)}. They may have been removed; find any you still need with \`search\` before calling it.`,
        ]),
    ...(namespaces.removed.length === 0
      ? []
      : [
          `The following tool namespaces are no longer available and must not be used: ${namespaces.removed
            .map((namespace) => `\`${namespace.name}\``)
            .join(", ")}.`,
        ]),
  ]
  if (parts.length === 0) return replacement
  const delta = ["The Code Mode tool catalog has changed.", ...parts].join("\n\n")
  return delta.length < replacement.length ? delta : replacement
}

function listed(heading: string, entries: ReadonlyArray<{ readonly line: string }>) {
  return entries.length === 0 ? [] : [[heading, ...entries.map((entry) => entry.line)].join("\n")]
}

function expressions(entries: ReadonlyArray<{ readonly path: string }>) {
  return entries.map((entry) => toolExpression(entry.path)).join(", ")
}

export const key = Instructions.Key.make("core/codemode")
const codec = Schema.toCodecJson(CodeModeCatalog.Summary)
const decode = Schema.decodeUnknownOption(codec)

/** `previous` is the catalog value the session last admitted, as stored; an undecodable one is ignored. */
export const make = (inventory?: CodeModeCatalog.Inventory, previous?: Schema.Json): Instructions.List => {
  const catalog =
    inventory === undefined
      ? Instructions.removed
      : CodeModeCatalog.summarize(inventory, { previous: Option.getOrUndefined(decode(previous)) })
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
