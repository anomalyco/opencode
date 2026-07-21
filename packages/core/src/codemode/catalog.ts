export * as CodeModeCatalog from "./catalog"

import { CodeMode } from "@opencode-ai/codemode"
import { Schema } from "effect"
import { Instructions } from "../instructions/index"

// Model-facing descriptor for one Code Mode tool. Codemode constructs paths and
// signatures; this module owns every piece of agent-facing catalog prose.
export const Entry = Schema.Struct({
  path: Schema.String,
  description: Schema.String,
  signature: Schema.String,
})
export type Entry = typeof Entry.Type

/** Approximate token budget (chars/4) for inlined full catalog entries. */
export const defaultBudget = 2_000

const estimateTokens = (input: string) => Math.max(0, Math.round(input.length / 4))

const line = (tool: Entry) => {
  const first = tool.description.split("\n", 1)[0]!.trim()
  const description = first.length > 120 ? first.slice(0, 119) + "..." : first
  return description === "" ? `  - ${tool.signature}` : `  - ${tool.signature} // ${description}`
}

type Plan = {
  readonly ordered: ReadonlyArray<readonly [string, ReadonlyArray<Entry>]>
  readonly shown: ReadonlyMap<string, ReadonlySet<Entry>>
  readonly totalShown: number
  readonly complete: boolean
}

// Budget signatures round-robin so every namespace remains visible.
const plan = (entries: ReadonlyArray<Entry>, budget: number): Plan => {
  const namespaces = new Map<string, Array<Entry>>()
  for (const tool of entries) {
    const [namespace = tool.path] = tool.path.split(".")
    const group = namespaces.get(namespace) ?? []
    group.push(tool)
    namespaces.set(namespace, group)
  }
  const ordered = [...namespaces].sort(([left], [right]) => left.localeCompare(right))

  const selections = ordered.map(([namespace, group]) => ({
    namespace,
    picked: new Set<Entry>(),
    queue: [...group].sort(
      (left, right) => estimateTokens(line(left)) - estimateTokens(line(right)) || left.path.localeCompare(right.path),
    ),
  }))
  let used = 0
  let active = selections.filter((selection) => selection.queue.length > 0)
  while (active.length > 0) {
    const stillActive: typeof active = []
    for (const selection of active) {
      const tool = selection.queue[0]!
      const cost = estimateTokens(line(tool))
      if (used + cost > budget) continue
      selection.queue.shift()
      selection.picked.add(tool)
      used += cost
      if (selection.queue.length > 0) stillActive.push(selection)
    }
    active = stillActive
  }
  const totalShown = selections.reduce((total, { picked }) => total + picked.size, 0)
  return {
    ordered,
    shown: new Map(selections.map(({ namespace, picked }) => [namespace, picked])),
    totalShown,
    complete: totalShown === entries.length,
  }
}

/** Renders the full agent-facing Code Mode instructions for one catalog snapshot. */
export const render = (entries: ReadonlyArray<Entry>, budget = defaultBudget): string => {
  const planned = plan(entries, budget)
  const empty = entries.length === 0

  const intro = [
    empty
      ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime."
      : planned.complete
        ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the tools listed below; surrounding agent tools are not available."
        : "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the tools listed or searchable below; surrounding agent tools are not available.",
    ...(empty
      ? []
      : ["Do not infer or normalize tool names; use only exact signatures shown below or returned by search."]),
  ]

  const workflow = empty
    ? []
    : [
        "",
        "## Workflow",
        "",
        ...(planned.complete
          ? [
              "1. Pick a tool from the list under `## Available tools` - each line is the exact call signature; use it as-is rather than guessing segments.",
              "2. Call it using the exact signature shown: `const result = await tools.<namespace>.<tool>(input)`; bracket notation and quotes are part of the path.",
              "3. Return only the fields you need from structured results; narrow unknown results before reading fields, and avoid returning large raw payloads.",
            ]
          : [
              '1. If needed, discover tools with the built-in search function: `return search({ query: "<intent + key nouns>" })`.',
              "2. In the next execution, copy a returned path exactly, call it, and return only the needed fields.",
            ]),
      ]

  const rules = empty
    ? []
    : [
        "",
        "## Rules",
        "",
        planned.complete
          ? "- Only tools listed here are available; surrounding agent tools are not implicitly exposed."
          : "- Only tools listed here or returned by the built-in `search` function are available; surrounding agent tools are not implicitly exposed.",
        "- Filter, aggregate, and transform collections in code - never return them raw or call a tool per item across messages.",
        "- A result typed `Promise<unknown>` may be structured data or text. Before reading fields, check that it is a non-null object and not an array; otherwise handle the returned text or primitive directly.",
        '- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))`, or use `tools.<namespace>["tool-name"](item)` when the listed signature uses bracket notation.',
        "- Execution ends when the program returns; pending promises are interrupted, so await every call whose completion matters.",
        "- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.",
        ...(planned.complete
          ? []
          : [
              '- Browse one namespace: `search({ query: "", namespace: "<name>" })`.',
              "- If search returns `next`, repeat the same search with `offset: next.offset`.",
            ]),
      ]

  const language = [
    "",
    "## Language",
    "",
    "Use common JavaScript data operations, functions, control flow, selected standard-library methods, and awaited tool calls. Built-ins include Date, RegExp, Map, Set, URL, URLSearchParams, and URI encoding helpers.",
    "Modules/imports, classes, timers, fetch, eval, prototype access, and unlisted methods are unavailable. Use tools for external operations. Use await with try/catch.",
    "Prefer explicit `return`; otherwise only the final top-level expression becomes the result.",
    "Dates and URLs serialize to strings at data boundaries; Map/Set/RegExp/URLSearchParams serialize to `{}`.",
  ]

  const toolSection: Array<string> = [""]
  if (empty) {
    toolSection.push("## Available tools", "", "No tools are currently available.")
  } else {
    toolSection.push(
      planned.complete
        ? "## Available tools (COMPLETE list - every tool is shown below with its full call signature)"
        : `## Available tools (PARTIAL - ${planned.totalShown} of ${entries.length} shown; find the rest with search(...))`,
      "",
    )
    for (const [namespace, group] of planned.ordered) {
      const picked = planned.shown.get(namespace)!
      const count = `${group.length} tool${group.length === 1 ? "" : "s"}`
      const label =
        picked.size === group.length
          ? count
          : picked.size === 0
            ? `${count}, none shown`
            : `${count}, ${picked.size} shown`
      toolSection.push(`- ${namespace} (${label})`)
      for (const tool of group) if (picked.has(tool)) toolSection.push(line(tool))
    }
    if (!planned.complete) {
      toolSection.push("", "Search returns complete callable signatures:", `- ${CodeMode.searchSignature}`)
    }
  }

  return [...intro, ...workflow, ...rules, ...language, ...toolSection].join("\n")
}

const replacement = (current: ReadonlyArray<Entry>, budget: number) =>
  [
    "The Code Mode tool catalog has changed. This catalog supersedes the previous Code Mode tool catalog.",
    render(current, budget),
  ].join("\n\n")

/** Renders one mid-conversation catalog change as a semantic delta when it is smaller. */
export const update = (
  previous: ReadonlyArray<Entry>,
  current: ReadonlyArray<Entry>,
  budget = defaultBudget,
): string => {
  const diff = Instructions.diffByKey(
    previous,
    current,
    (tool) => tool.path,
    (before, after) => before.signature !== after.signature || before.description !== after.description,
  )
  const empty = diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0
  // Crossing between full and compact rendering changes the surrounding guidance, so restate everything.
  const crossed = plan(previous, budget).complete !== plan(current, budget).complete
  if (empty || crossed) return replacement(current, budget)
  const delta = [
    "The Code Mode tool catalog has changed.",
    ...(diff.added.length === 0
      ? []
      : [["New tools are available in addition to those previously listed:", ...diff.added.map(line)].join("\n")]),
    ...(diff.changed.length === 0
      ? []
      : [
          [
            "Changed tool signatures supersede the previously listed ones:",
            ...diff.changed.map((change) => line(change.current)),
          ].join("\n"),
        ]),
    ...(diff.removed.length === 0
      ? []
      : [
          `The following tools are no longer available and must not be called: ${diff.removed
            .map((tool) => CodeMode.toolExpression(tool.path))
            .join(", ")}.`,
        ]),
  ].join("\n\n")
  const full = replacement(current, budget)
  return delta.length < full.length ? delta : full
}
