export * as CodeModeInstructions from "./instructions"

import { searchSignature, toolExpression } from "@opencode-ai/codemode"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { Context, Effect, Layer, Schema } from "effect"
import { AgentV2 } from "../agent"
import { CodeMode } from "../codemode"
import { Instructions } from "../instructions/index"
import { CodeModeCatalog } from "./catalog"

const completeWorkflow = `## Workflow

1. Pick a tool from the list under \`## Available tools\` - each line is the exact call signature; use it as-is rather than guessing segments.
2. Call it using the exact signature shown: \`const result = await tools.<namespace>.<tool>(input)\`; bracket notation and quotes are part of the path.
3. Return only the fields you need from structured results; narrow unknown results before reading fields, and avoid returning large raw payloads.`

const partialWorkflow = `## Workflow

1. If needed, discover tools with the built-in search function: \`return search({ query: "<intent + key nouns>" })\`.
2. In the next execution, copy a returned path exactly, call it, and return only the needed fields.`

const language = `## Language

Use common JavaScript data operations, functions, control flow, selected standard-library methods, and awaited tool calls. Built-ins include Date, RegExp, Map, Set, URL, URLSearchParams, and URI encoding helpers.
Modules/imports, classes, timers, fetch, eval, prototype access, and unlisted methods are unavailable. Use tools for external operations. Use await with try/catch.
Prefer explicit \`return\`; otherwise only the final top-level expression becomes the result.
Dates and URLs serialize to strings at data boundaries; Map/Set/RegExp/URLSearchParams serialize to \`{}\`.`

export function render(catalog: CodeModeCatalog.Summary) {
  const complete = catalog.shown === catalog.total
  const sections: Array<string> = []

  if (catalog.total === 0) {
    sections.push("This is a restricted JavaScript language for calling tools, not a general-purpose runtime.")
  } else {
    const availability = (() => {
      if (complete) return "listed below"
      return "listed or searchable below"
    })()
    sections.push(
      `This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, \`tools\` contains the tools ${availability}; surrounding agent tools are not available.\nDo not infer or normalize tool names; use only exact signatures shown below or returned by search.`,
    )

    if (complete) sections.push(completeWorkflow)
    if (!complete) sections.push(partialWorkflow)

    const availabilityRule = (() => {
      if (complete) return "- Only tools listed here are available; surrounding agent tools are not implicitly exposed."
      return "- Only tools listed here or returned by the built-in `search` function are available; surrounding agent tools are not implicitly exposed."
    })()
    const rules = [
      "## Rules",
      "",
      availabilityRule,
      "- Filter, aggregate, and transform collections in code - never return them raw or call a tool per item across messages.",
      "- A result typed `Promise<unknown>` may be structured data or text. Before reading fields, check that it is a non-null object and not an array; otherwise handle the returned text or primitive directly.",
      '- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))`, or use `tools.<namespace>["tool-name"](item)` when the listed signature uses bracket notation.',
      "- Execution ends when the program returns; pending promises are interrupted, so await every call whose completion matters.",
      "- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.",
    ]
    if (!complete) {
      rules.push(
        '- Browse one namespace: `search({ query: "", namespace: "<name>" })`.',
        "- If search returns `next`, repeat the same search with `offset: next.offset`.",
      )
    }
    sections.push(rules.join("\n"))
  }

  sections.push(language)

  if (catalog.total === 0) {
    sections.push("No tools are currently available.")
    return sections.join("\n\n")
  }

  const tools: Array<string> = []
  if (complete) {
    tools.push("## Available tools (COMPLETE list - every tool is shown below with its full call signature)", "")
  } else {
    tools.push(
      `## Available tools (PARTIAL - ${catalog.shown} of ${catalog.total} shown; find the rest with search(...))`,
      "",
    )
  }

  for (const namespace of catalog.namespaces) {
    const count = (() => {
      if (namespace.count === 1) return "1 tool"
      return `${namespace.count} tools`
    })()
    const label = (() => {
      if (namespace.entries.length === namespace.count) return count
      if (namespace.entries.length === 0) return `${count}, none shown`
      return `${count}, ${namespace.entries.length} shown`
    })()
    tools.push(`- ${namespace.name} (${label})`, ...namespace.entries.map((entry) => entry.line))
  }

  if (!complete) tools.push("", "Search returns complete callable signatures:", `- ${searchSignature}`)
  sections.push(tools.join("\n"))

  return sections.join("\n\n")
}

export function update(previous: CodeModeCatalog.Summary, current: CodeModeCatalog.Summary) {
  const full = [
    "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
    render(current),
  ].join("\n\n")
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
      ["New tools are available in addition to those previously listed:", ...diff.added.map((entry) => entry.line)].join(
        "\n",
      ),
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

export interface Interface {
  readonly load: (agent: AgentV2.Selection) => Effect.Effect<Instructions.Instructions>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/CodeModeInstructions") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const codeMode = yield* CodeMode.Service

    return Service.of({
      load: Effect.fn("CodeModeInstructions.load")(function* (selection) {
        const entries = selection.info
          ? ((yield* codeMode.materialize(selection.info.permissions)).catalog ?? [])
          : []
        const catalog = CodeModeCatalog.summarize(entries)
        return Instructions.make<CodeModeCatalog.Summary>({
          key: Instructions.Key.make("core/codemode"),
          codec: Schema.toCodecJson(CodeModeCatalog.Summary),
          read: Effect.succeed(catalog.total === 0 ? Instructions.removed : catalog),
          render: {
            initial: render,
            changed: update,
            removed: () => "Code Mode tools are no longer available. Do not use any previously listed Code Mode tools.",
          },
        })
      }),
    })
  }),
)

export const node = makeLocationNode({ service: Service, layer, deps: [CodeMode.node] })
