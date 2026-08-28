import { Cause, Effect, Exit, Formatter, Schema } from "effect"
import { toolError } from "./tool-error.js"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  identifierSegment,
  inputProperties,
  inputTypeScript,
  outputTypeScript,
} from "./tool-schema.js"
import { isTool, type Tool } from "./tool.js"
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

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

export type Services<T> = ServicesOf<T, []>

type ServicesOf<T, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : T extends {
        readonly _tag: "CodeModeTool"
        readonly execute: (input: unknown) => Effect.Effect<unknown, unknown, infer R>
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
  readonly outcome: "success" | "failure" | "interrupted"
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
export const toolExpression = (path: string) =>
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

// "json" mirrors JSON.stringify (undefined object values drop, undefined array elements become
// null, a bare undefined passes through): use it wherever data leaves as JSON, like tool
// arguments and stringify-style formatting. "nullify" turns every undefined, including a bare
// one, into null: use it for program results, where the consumer must never see undefined.
export type CopyOutMode = "json" | "nullify"

export const copyOut = (value: unknown, mode: CopyOutMode): unknown => {
  if (value === undefined && mode === "nullify") return null
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null
  }
  if (Array.isArray(value)) {
    // Array.from densifies holes so sparse arrays normalize at the boundary like JSON does.
    return Array.from(value, (item) => {
      const copied = copyOut(item, mode)
      return copied === undefined && mode === "json" ? null : copied
    })
  }

  if (value !== null && typeof value === "object" && !(value instanceof ToolReference)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, copyOut(item, mode)] as const)
        .filter(([, item]) => !(item === undefined && mode === "json")),
    )
  }

  return value
}

// Dots in tool names are namespace separators; the last tool for a canonical path wins.
type ToolNode<R> = {
  tool?: Tool<R>
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
      if (isTool<R>(value)) current.tool = value
      else insert(current, value)
    }
  }
  insert(root, tools)
  return root
}

const canonicalSegments = (path: ReadonlyArray<string>): ReadonlyArray<string> =>
  path.flatMap((segment) => segment.split("."))

const flattenTools = <R>(
  node: ToolNode<R>,
  path: ReadonlyArray<string> = [],
): Array<{ path: string; tool: Tool<R> }> => [
  ...(node.tool === undefined ? [] : [{ path: path.join("."), tool: node.tool }]),
  ...Array.from(node.children, ([name, child]) => flattenTools(child, [...path, name])).flat(),
]

const describeTool = <R>(path: string, tool: Tool<R>): ToolDescription => ({
  path,
  description: tool.description,
  signature: `${toolExpression(path)}(input: ${inputTypeScript(tool, true)}): Promise<${outputTypeScript(tool, true)}>`,
})

// Discovery bytes are durable instructions, so order only after canonical-path collisions settle.
const visibleTools = <R>(tools: Tools<R>) =>
  flattenTools(toolTrie(tools))
    .sort((left, right) => compareText(left.path, right.path))
    .map(({ path, tool }) => ({
      path,
      tool,
      description: describeTool(path, tool),
    }))

export type DiscoveryPlan = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly searchIndex: ReadonlyArray<SearchEntry>
}

export type SearchEntry = {
  readonly description: ToolDescription
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

const makeSearchTool = (searchIndex: ReadonlyArray<SearchEntry>): Tool => ({
  _tag: "CodeModeTool",
  description: "Search available tools",
  input: SearchInput,
  output: SearchOutput,
  execute: (input) =>
    Effect.sync(() => {
      const request = input as typeof SearchInput.Type
      const query = request.query ?? ""
      const offset = request.offset ?? 0
      const scoped =
        request.namespace === undefined
          ? searchIndex
          : searchIndex.filter(
              (entry) =>
                entry.description.path === request.namespace ||
                entry.description.path.startsWith(`${request.namespace}.`),
            )
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
                  right.score - left.score || compareText(left.entry.description.path, right.entry.description.path),
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

/** Exact callable signature of the built-in `search` function, for host-owned instructions. */
export const searchSignature = (() => {
  const tool = makeSearchTool([])
  return `search(input: ${inputTypeScript(tool, true)}): ${outputTypeScript(tool, true)}`
})()

const toSearchEntry = <R>(path: string, tool: Tool<R>, description: ToolDescription): SearchEntry => ({
  description,
  searchText: [
    path,
    tool.description,
    ...inputProperties(tool).flatMap(({ name, description: property }) =>
      property === undefined ? [name] : [name, property],
    ),
  ]
    .join("\n")
    .toLowerCase(),
})

export const searchIndex = <R>(tools: Tools<R>): ReadonlyArray<SearchEntry> =>
  visibleTools(tools).map(({ path, tool, description }) => toSearchEntry(path, tool, description))

export const prepare = <R>(tools: Tools<R>): DiscoveryPlan => {
  const visible = visibleTools(tools)
  return {
    catalog: visible.map(({ description }) => description),
    searchIndex: visible.map(({ path, tool, description }) => toSearchEntry(path, tool, description)),
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

const resolve = <R>(root: ToolNode<R>, path: ReadonlyArray<string>): Tool<R> => {
  const segments = canonicalSegments(path)
  const node = lookup(root, segments)
  if (node === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Unknown tool '${segments.join(".")}'.`, [
      "The tool may have been removed or renamed. Use search to find available tools.",
    ])
  }
  if (node.tool === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Tool '${segments.join(".")}' is not callable.`)
  }
  return node.tool
}

export type ToolRuntime<R = never> = {
  readonly root: ToolReference
  readonly calls: Array<ToolCall>
  readonly execute: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
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

  const observeEnd = <A, E>(effect: Effect.Effect<A, E, R>, call: ToolCallStarted): Effect.Effect<A, E, R> => {
    const onEnd = hooks?.onToolCallEnd
    if (onEnd === undefined) return effect
    const startedAt = Date.now()
    return effect.pipe(
      Effect.onExit((exit) => {
        const durationMs = Date.now() - startedAt
        if (Exit.isSuccess(exit)) return onEnd({ ...call, durationMs, outcome: "success" })
        if (Cause.hasInterruptsOnly(exit.cause)) return onEnd({ ...call, durationMs, outcome: "interrupted" })
        const error = Cause.squash(exit.cause)
        const message = error instanceof Error ? error.message : Cause.pretty(exit.cause)
        return onEnd({ ...call, durationMs, outcome: "failure", message })
      }),
    )
  }

  const recordCall = (call: ToolCall): void => {
    if (maxToolCalls !== undefined && calls.length >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    calls.push(call)
  }

  const executeTool = (name: string, tool: Tool<R>, externalArgs: Array<unknown>) =>
    Effect.gen(function* () {
      if (externalArgs.length !== 1)
        throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects exactly one input object.`)
      const input = yield* Effect.try({
        try: () => decodeToolInput(tool, externalArgs[0]),
        catch: (cause) =>
          new ToolRuntimeError(
            "InvalidToolInput",
            `Invalid input for tool '${name}': ${String(cause)}`,
            name === "search" ? [] : ["The signature may have changed. Use search to get the current signature."],
          ),
      })
      const index = yield* Effect.sync(() => {
        recordCall({ name })
        return calls.length - 1
      })
      const call = { index, name, input }
      return yield* observeEnd(
        Effect.gen(function* () {
          if (hooks?.onToolCallStart !== undefined) yield* hooks.onToolCallStart(call)
          const raw = yield* Effect.suspend(() => tool.execute(input)).pipe(
            Effect.catchCause((cause) => {
              if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              return Effect.fail(
                toolError(
                  Cause.prettyErrors(cause)
                    .map((error) => (error.cause ? Formatter.format(error) : error.message || error.name))
                    .join("\n"),
                ),
              )
            }),
          )
          return yield* Effect.try({
            try: () => copyIn(decodeToolOutput(tool, raw), `Result from tool '${name}'`),
            catch: (cause) => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}': ${cause}`),
          })
        }),
        call,
      )
    })

  return {
    root: new ToolReference([]),
    calls,
    keys: (path) => namespaceKeys(root, path),
    search: (args) =>
      Effect.suspend(() =>
        executeTool(
          "search",
          searchTool,
          args.map((arg) => copyOut(copyIn(arg, "Arguments for tool 'search'"), "json")),
        ),
      ),
    execute: (path, args) =>
      Effect.gen(function* () {
        const name = canonicalSegments(path).join(".")
        const externalArgs = args.map((arg) => copyOut(copyIn(arg, `Arguments for tool '${name}'`), "json"))
        const tool = resolve(root, path)
        return yield* executeTool(name, tool, externalArgs)
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
