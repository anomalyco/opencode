import { Cause, Effect, Schema } from "effect"
import { ToolError, toolError } from "./tool-error.js"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  identifierSegment,
  inputProperties,
  inputTypeScript,
  outputTypeScript,
} from "./tool-schema.js"
import { isDefinition as isToolDefinition, type Definition } from "./tool.js"
import type { Tools } from "./tools.js"
import {
  CodeModeDate,
  CodeModeMap,
  CodeModePromise,
  CodeModeRegExp,
  CodeModeSet,
  CodeModeURL,
  CodeModeURLSearchParams,
} from "./values.js"

const estimateTokens = (input: string) => Math.max(0, Math.round(input.length / 4))

export type Services<T> = ServicesOf<T, []>

type ServicesOf<T, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : T extends {
        readonly _tag: "CodeModeTool"
        readonly run: (input: unknown) => Effect.Effect<unknown, unknown, infer R>
      }
    ? R
    : T extends object
      ? string extends keyof T
        ? ServicesOf<T[string], [...Depth, unknown]>
        : ServicesOf<T[keyof T], [...Depth, unknown]>
      : never

export type ToolCall = {
  readonly name: string
}

export type ToolCallStarted = {
  readonly index: number
  readonly name: string
  readonly input: unknown
}

export type ToolCallEnded = {
  readonly index: number
  readonly name: string
  readonly input: unknown
  readonly durationMs: number
  readonly outcome: "success" | "failure"
  readonly message?: string
}

export type ToolCallHooks<R = never> = {
  readonly onToolCallStart?: ((call: ToolCallStarted) => Effect.Effect<void, never, R>) | undefined
  readonly onToolCallEnd?: ((call: ToolCallEnded) => Effect.Effect<void, never, R>) | undefined
}

export type ToolDescription = {
  readonly path: string
  readonly description: string
  readonly signature: string
}

export type SafeObject = Record<string, unknown>

const defaultCatalogBudget = 2_000
const defaultSearchLimit = 10
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const SearchInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(PositiveInt),
  offset: Schema.optionalKey(NonNegativeInt),
})
const SearchItem = Schema.Struct({
  path: Schema.String,
  description: Schema.String,
  signature: Schema.String,
})
const SearchOutput = Schema.Struct({
  items: Schema.Array(SearchItem),
  remaining: NonNegativeInt,
  next: Schema.NullOr(Schema.Struct({ offset: NonNegativeInt })),
})
const toolExpression = (path: string) =>
  "tools" +
  path
    .split(".")
    .map((segment) => (identifierSegment.test(segment) ? `.${segment}` : `[${JSON.stringify(segment)}]`))
    .join("")

export class ToolReference {
  constructor(readonly path: ReadonlyArray<string>) {}
}

const MAX_VALUE_DEPTH = 32

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind:
      | "UnknownTool"
      | "InvalidToolInput"
      | "InvalidToolOutput"
      | "InvalidDataValue"
      | "ToolCallLimitExceeded",
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "ToolRuntimeError"
  }
}

const isDefinition = <R>(value: Definition<R> | Tools<R>): value is Definition<R> =>
  isToolDefinition<R>(value)

const runHost = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, ToolError, R> =>
  effect.pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
      const error = Cause.squash(cause)
      return Effect.fail(error instanceof ToolError ? error : toolError("Tool execution failed", error))
    }),
  )

const blockedMemberNames = new Set(["__proto__", "constructor", "prototype"])

export const isBlockedMember = (name: string): boolean => blockedMemberNames.has(name)

// Checkpoint mode preserves CodeMode values; boundary mode JSON-normalizes them.
export const copyIn = (value: unknown, label: string, preserveCodeModeValues = false): unknown =>
  copyBounded(value, label, 0, new Set(), preserveCodeModeValues)

const copyBounded = (
  value: unknown,
  label: string,
  depth: number,
  seen: Set<object>,
  preserveCodeModeValues: boolean,
): unknown => {
  if (depth > MAX_VALUE_DEPTH) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value
  }

  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }

  if (value instanceof CodeModePromise) {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains an un-awaited Promise; await tool calls (e.g. \`const result = await tools.ns.tool(...)\`) before using their results.`,
    )
  }

  if (preserveCodeModeValues) {
    if (
      value instanceof CodeModeDate ||
      value instanceof CodeModeRegExp ||
      value instanceof CodeModeMap ||
      value instanceof CodeModeSet ||
      value instanceof CodeModeURL ||
      value instanceof CodeModeURLSearchParams
    ) {
      return value
    }
    if (value instanceof Date) return new CodeModeDate(value.getTime())
    if (value instanceof RegExp) return new CodeModeRegExp(value.source, value.flags)
    if (value instanceof Map) {
      const wrapped = new CodeModeMap()
      for (const [key, item] of value.entries()) {
        wrapped.map.set(copyBounded(key, label, depth + 1, seen, true), copyBounded(item, label, depth + 1, seen, true))
      }
      return wrapped
    }
    if (value instanceof Set) {
      const wrapped = new CodeModeSet()
      for (const item of value.values()) wrapped.set.add(copyBounded(item, label, depth + 1, seen, true))
      return wrapped
    }
    if (value instanceof URL) return new CodeModeURL(new URL(value.href))
    if (value instanceof URLSearchParams) return new CodeModeURLSearchParams(new URLSearchParams(value))
  }

  if (value instanceof CodeModeDate) {
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (value instanceof CodeModeURL) return value.url.href
  if (value instanceof URL) return value.href
  if (
    value instanceof CodeModeRegExp ||
    value instanceof CodeModeMap ||
    value instanceof CodeModeSet ||
    value instanceof CodeModeURLSearchParams ||
    value instanceof RegExp ||
    value instanceof Map ||
    value instanceof Set ||
    value instanceof URLSearchParams
  ) {
    return Object.create(null) as SafeObject
  }

  if (seen.has(value)) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
  }

  seen.add(value)

  if (Array.isArray(value)) {
    const copied = value.map((item) => copyBounded(item, label, depth + 1, seen, preserveCodeModeValues))
    if (preserveCodeModeValues) {
      // Checkpoint copies retain array metadata that boundary copies omit.
      for (const [key, item] of Object.entries(value)) {
        if (Object.hasOwn(copied, key)) continue
        if (isBlockedMember(key)) {
          throw new ToolRuntimeError("InvalidDataValue", `${label} contains blocked property '${key}'.`)
        }
        Reflect.set(copied, key, copyBounded(item, label, depth + 1, seen, true))
      }
    }
    seen.delete(value)
    return copied
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain plain objects only.`)
  }

  const copied: SafeObject = Object.create(null) as SafeObject
  for (const [key, item] of Object.entries(value)) {
    if (isBlockedMember(key)) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} contains blocked property '${key}'.`)
    }
    copied[key] = copyBounded(item, label, depth + 1, seen, preserveCodeModeValues)
  }
  seen.delete(value)
  return copied
}

export const copyOut = (value: unknown, undefinedAsNull = false): unknown => {
  if (value === undefined && undefinedAsNull) return null
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null
  }
  if (Array.isArray(value)) {
    // Array.from densifies holes so sparse arrays normalize at the boundary like JSON does.
    return Array.from(value, (item) => copyOut(item, undefinedAsNull))
  }

  if (value !== null && typeof value === "object" && !(value instanceof ToolReference)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyOut(item, undefinedAsNull)]))
  }

  return value
}

// Dots in tool names are namespace separators; the last definition for a canonical path wins.
type ToolNode<R> = {
  definition?: Definition<R>
  readonly children: Map<string, ToolNode<R>>
}

const toolTrie = <R>(tools: Tools<R>): ToolNode<R> => {
  const root: ToolNode<R> = { children: new Map() }
  const insert = (node: ToolNode<R>, group: Tools<R>): void => {
    for (const [name, value] of Object.entries(group)) {
      let current = node
      for (const segment of name.split(".")) {
        if (segment === "") throw new TypeError(`Tool name '${name}' contains an empty segment.`)
        const child = current.children.get(segment) ?? { children: new Map() }
        current.children.set(segment, child)
        current = child
      }
      if (isDefinition(value)) current.definition = value
      else insert(current, value)
    }
  }
  insert(root, tools)
  return root
}

const canonicalSegments = (path: ReadonlyArray<string>): ReadonlyArray<string> =>
  path.flatMap((segment) => segment.split("."))

const definitions = <R>(
  node: ToolNode<R>,
  path: ReadonlyArray<string> = [],
): Array<{ path: string; definition: Definition<R> }> => [
  ...(node.definition === undefined ? [] : [{ path: path.join("."), definition: node.definition }]),
  ...Array.from(node.children, ([name, child]) => definitions(child, [...path, name])).flat(),
]

const describeDefinition = <R>(path: string, definition: Definition<R>): ToolDescription => ({
  path,
  description: definition.description,
  signature: `${toolExpression(path)}(input: ${inputTypeScript(definition, true)}): Promise<${outputTypeScript(definition, true)}>`,
})

const visibleDefinitions = <R>(tools: Tools<R>) =>
  definitions(toolTrie(tools)).map(({ path, definition }) => ({
    path,
    definition,
    description: describeDefinition(path, definition),
  }))

export type DiscoveryPlan = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly instructions: string
  readonly searchIndex: ReadonlyArray<SearchEntry>
}

export type SearchEntry = {
  readonly description: ToolDescription
  readonly namespace: string
  readonly searchText: string
}

const tokenize = (query: string): Array<string> =>
  query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && term !== "*")

const termForms = (term: string): Array<string> => {
  const forms = [term]
  if (term.endsWith("es") && term.length > 3) forms.push(term.slice(0, -2))
  if (term.endsWith("s") && term.length > 2) forms.push(term.slice(0, -1))
  return forms
}

const makeSearchTool = (searchIndex: ReadonlyArray<SearchEntry>): Definition => ({
  _tag: "CodeModeTool",
  description: "Search available Code Mode tools",
  input: SearchInput,
  output: SearchOutput,
  run: (input) =>
    Effect.sync(() => {
      const request = input as typeof SearchInput.Type
      const query = request.query ?? ""
      const offset = request.offset ?? 0
      const scoped =
        request.namespace === undefined
          ? searchIndex
          : searchIndex.filter((entry) => entry.namespace === request.namespace)
      const trimmed = query.trim()
      const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice("tools.".length) : trimmed
      const exact =
        pathQuery === ""
          ? undefined
          : scoped.find(
              (entry) => entry.description.path === pathQuery || toolExpression(entry.description.path) === trimmed,
            )
      const terms = tokenize(query).map(termForms)
      const ranked =
        exact !== undefined
          ? [exact]
          : scoped
              .map((entry) => {
                const path = entry.description.path.toLowerCase()
                const description = entry.description.description.toLowerCase()
                const score = terms.reduce(
                  (total, forms) =>
                    total +
                    (forms.some((form) => path === form || path.endsWith(`.${form}`)) ? 20 : 0) +
                    (forms.some((form) => path.includes(form)) ? 8 : 0) +
                    (forms.some((form) => description.includes(form)) ? 4 : 0) +
                    (forms.some((form) => entry.searchText.includes(form)) ? 2 : 0),
                  0,
                )
                return { entry, score }
              })
              .filter(({ score }) => terms.length === 0 || score > 0)
              .sort(
                (left, right) =>
                  right.score - left.score || left.entry.description.path.localeCompare(right.entry.description.path),
              )
              .map(({ entry }) => entry)
      const items = ranked.slice(offset, offset + (request.limit ?? defaultSearchLimit)).map(({ description }) => ({
        ...description,
        path: toolExpression(description.path),
      }))
      const remaining = Math.max(0, ranked.length - offset - items.length)
      return {
        items,
        remaining,
        next: remaining > 0 ? { offset: offset + items.length } : null,
      }
    }),
})

const searchSignature = (() => {
  const definition = makeSearchTool([])
  return `search(input: ${inputTypeScript(definition, true)}): ${outputTypeScript(definition, true)}`
})()

const catalogLine = (tool: ToolDescription) => {
  const line = tool.description.split("\n", 1)[0]!.trim()
  const description = line.length > 120 ? line.slice(0, 119) + "..." : line
  return description === "" ? `  - ${tool.signature}` : `  - ${tool.signature} // ${description}`
}

const toSearchEntry = <R>(path: string, definition: Definition<R>, description: ToolDescription): SearchEntry => ({
  description,
  namespace: path.split(".", 1)[0]!,
  searchText: [
    path,
    definition.description,
    ...inputProperties(definition).flatMap(({ name, description: property }) =>
      property === undefined ? [name] : [name, property],
    ),
  ]
    .join("\n")
    .toLowerCase(),
})

export const searchIndex = <R>(tools: Tools<R>): ReadonlyArray<SearchEntry> =>
  visibleDefinitions(tools).map(({ path, definition, description }) => toSearchEntry(path, definition, description))

// Budget signatures round-robin so every namespace remains visible.
export const prepare = <R>(tools: Tools<R>, catalogBudget = defaultCatalogBudget): DiscoveryPlan => {
  if (!Number.isSafeInteger(catalogBudget) || catalogBudget < 0) {
    throw new RangeError("discovery.catalogBudget must be a non-negative safe integer")
  }
  const visible = visibleDefinitions(tools)
  const described = visible.map(({ description }) => description)

  const namespaces = new Map<string, Array<ToolDescription>>()
  for (const tool of described) {
    const [namespace = tool.path] = tool.path.split(".")
    const group = namespaces.get(namespace) ?? []
    group.push(tool)
    namespaces.set(namespace, group)
  }
  const ordered = [...namespaces].sort(([left], [right]) => left.localeCompare(right))

  const selections = ordered.map(([namespace, group]) => ({
    namespace,
    picked: new Set<ToolDescription>(),
    queue: [...group].sort(
      (left, right) =>
        estimateTokens(catalogLine(left)) - estimateTokens(catalogLine(right)) || left.path.localeCompare(right.path),
    ),
  }))
  let used = 0
  let active = selections.filter((selection) => selection.queue.length > 0)
  while (active.length > 0) {
    const stillActive: typeof active = []
    for (const selection of active) {
      const tool = selection.queue[0]!
      const cost = estimateTokens(catalogLine(tool))
      if (used + cost > catalogBudget) continue
      selection.queue.shift()
      selection.picked.add(tool)
      used += cost
      if (selection.queue.length > 0) stillActive.push(selection)
    }
    active = stillActive
  }
  const shown = new Map<string, ReadonlySet<ToolDescription>>(
    selections.map(({ namespace, picked }) => [namespace, picked]),
  )
  const totalShown = selections.reduce((total, { picked }) => total + picked.size, 0)
  const complete = totalShown === described.length

  const empty = described.length === 0

  const intro = [
    empty
      ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime."
      : complete
        ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the Code Mode tools listed below; surrounding agent tools are not available."
        : "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the Code Mode tools listed or searchable below; surrounding agent tools are not available.",
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
        ...(complete
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
        complete
          ? "- Only Code Mode tools listed here are available; surrounding agent tools are not implicitly exposed."
          : "- Only Code Mode tools listed here or returned by the built-in `search` function are available; surrounding agent tools are not implicitly exposed.",
        "- Filter, aggregate, and transform collections in code - never return them raw or call a tool per item across messages.",
        "- A result typed `Promise<unknown>` may be structured data or text. Before reading fields, check that it is a non-null object and not an array; otherwise handle the returned text or primitive directly.",
        '- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))`, or use `tools.<namespace>["tool-name"](item)` when the listed signature uses bracket notation.',
        "- Execution ends when the program returns; pending promises are interrupted, so await every call whose completion matters.",
        "- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.",
        ...(complete
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
    "Modules/imports, classes, generators, timers, fetch, eval, prototype access, and unlisted methods are unavailable. Use Code Mode tools for external operations. Use await with try/catch.",
    "Prefer explicit `return`; otherwise only the final top-level expression becomes the result.",
    "Dates and URLs serialize to strings at data boundaries; Map/Set/RegExp/URLSearchParams serialize to `{}`.",
  ]

  const toolSection: Array<string> = [""]
  if (empty) {
    toolSection.push("## Available tools", "", "No tools are currently available.")
  } else {
    toolSection.push(
      complete
        ? "## Available tools (COMPLETE list - every tool is shown below with its full call signature)"
        : `## Available tools (PARTIAL - ${totalShown} of ${described.length} shown; find the rest with search(...))`,
      "",
    )
    for (const [namespace, group] of ordered) {
      const picked = shown.get(namespace)!
      const count = `${group.length} tool${group.length === 1 ? "" : "s"}`
      const label =
        picked.size === group.length
          ? count
          : picked.size === 0
            ? `${count}, none shown`
            : `${count}, ${picked.size} shown`
      toolSection.push(`- ${namespace} (${label})`)
      for (const tool of group) if (picked.has(tool)) toolSection.push(catalogLine(tool))
    }
    if (!complete) {
      toolSection.push("", "Search returns complete callable signatures:", `- ${searchSignature}`)
    }
  }

  const lines = [...intro, ...workflow, ...rules, ...language, ...toolSection]
  return {
    catalog: described,
    instructions: lines.join("\n"),
    searchIndex: visible.map(({ path, definition, description }) => toSearchEntry(path, definition, description)),
  }
}

const lookup = <R>(root: ToolNode<R>, segments: ReadonlyArray<string>): ToolNode<R> | undefined =>
  segments.reduce<ToolNode<R> | undefined>((node, segment) => node?.children.get(segment), root)

const namespaceKeys = <R>(root: ToolNode<R>, path: ReadonlyArray<string>): ReadonlyArray<string> => {
  const segments = canonicalSegments(path)
  const node = lookup(root, segments)
  if (node === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Unknown tool namespace '${segments.join(".")}'.`)
  }
  return Array.from(node.children.keys())
}

const resolve = <R>(root: ToolNode<R>, path: ReadonlyArray<string>): Definition<R> => {
  const segments = canonicalSegments(path)
  const node = lookup(root, segments)
  if (node === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Unknown tool '${segments.join(".")}'.`, [
      "Use search({ query }) to find available described tools.",
    ])
  }
  if (node.definition === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Tool '${segments.join(".")}' is not callable.`)
  }
  return node.definition
}

export type ToolRuntime<R = never> = {
  readonly root: ToolReference
  readonly calls: Array<ToolCall>
  readonly invoke: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  readonly search: (args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
}

export const make = <R>(
  tools: Tools<R>,
  maxToolCalls: number | undefined,
  searchIndex: ReadonlyArray<SearchEntry>,
  hooks?: ToolCallHooks<R>,
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  const root = toolTrie(tools)
  const searchTool = makeSearchTool(searchIndex)

  // End hooks observe settled success or failure; interruption emits neither outcome.
  const observeEnd = <A, E>(effect: Effect.Effect<A, E, R>, call: ToolCallStarted): Effect.Effect<A, E, R> => {
    const onEnd = hooks?.onToolCallEnd
    if (onEnd === undefined) return effect
    const startedAt = Date.now()
    return effect.pipe(
      Effect.tap(() => onEnd({ ...call, durationMs: Date.now() - startedAt, outcome: "success" })),
      Effect.tapError((error) => {
        const message =
          error instanceof ToolError || error instanceof ToolRuntimeError ? error.message : "Tool execution failed"
        return onEnd({
          ...call,
          durationMs: Date.now() - startedAt,
          outcome: "failure",
          message,
        })
      }),
    )
  }

  const decodeOutput = (value: unknown, name: string) =>
    Effect.try({
      try: () => copyIn(value, `Result from tool '${name}'`),
      catch: () => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}'.`),
    })

  const recordCall = (call: ToolCall): void => {
    if (maxToolCalls !== undefined && calls.length >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    calls.push(call)
  }

  const recordAndObserve = (name: string, input: unknown) =>
    Effect.sync(() => {
      recordCall({ name })
      return calls.length - 1
    }).pipe(Effect.tap((index) => hooks?.onToolCallStart?.({ index, name, input }) ?? Effect.void))

  const invokeDefinition = (name: string, tool: Definition<R>, externalArgs: Array<unknown>) =>
    Effect.gen(function* () {
      if (externalArgs.length !== 1)
        throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects exactly one input object.`)
      const input = yield* Effect.try({
        try: () => decodeToolInput(tool, externalArgs[0]),
        catch: (cause) =>
          new ToolRuntimeError("InvalidToolInput", `Invalid input for tool '${name}': ${String(cause)}`),
      })
      const index = yield* recordAndObserve(name, input)
      return yield* observeEnd(
        Effect.gen(function* () {
          const raw = yield* runHost(Effect.suspend(() => tool.run(input)))
          const result = yield* Effect.try({
            try: () => decodeToolOutput(tool, raw),
            catch: () => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}'.`),
          })
          return yield* decodeOutput(result, name)
        }),
        { index, name, input },
      )
    })

  return {
    root: new ToolReference([]),
    calls,
    keys: (path) => namespaceKeys(root, path),
    search: (args) =>
      Effect.suspend(() =>
        invokeDefinition(
          "search",
          searchTool,
          args.map((arg) => copyOut(copyIn(arg, "Arguments for tool 'search'"))),
        ),
      ),
    invoke: (path, args) =>
      Effect.gen(function* () {
        const name = canonicalSegments(path).join(".")
        const externalArgs = args.map((arg) => copyOut(copyIn(arg, `Arguments for tool '${name}'`)))
        const tool = resolve(root, path)
        return yield* invokeDefinition(name, tool, externalArgs)
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
