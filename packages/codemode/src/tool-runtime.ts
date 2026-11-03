import { Cause, Effect, Exit, Formatter, Schema } from "effect"
import type { Json } from "./data.js"
import type { DiagnosticKind } from "./codemode.js"
import { toolError } from "./tool-error.js"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  type Language,
  member,
  inputProperties,
  inputType,
  isEmptyInput,
  outputType,
} from "./tool-schema.js"
import { isNamespace, type Namespace } from "./namespace.js"
import { isTool, type Tool } from "./tool.js"
import type { Tools } from "./tools.js"

export const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

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

/** A tool call the program is making, with its decoded input. */
export type ToolInvocation = { readonly name: string; readonly input: unknown }

/**
 * A call the program is making to an extension global or module function, with its arguments. A module function is
 * named by its path from the module, such as `fs.readFile`.
 */
export type ExtensionInvocation = {
  readonly extension: string
  readonly name: string
  readonly args: ReadonlyArray<unknown>
}

/** How a call ended; `after` hooks observe it and cannot change it. */
export type CallResult =
  | { readonly status: "success"; readonly value: unknown }
  | { readonly status: "failure"; readonly error: unknown }
  | { readonly status: "interrupted" }

/** Hooks around every call the program makes into the host. A failing `before` denies the call. */
export type Hooks<R = never> = {
  readonly "tool.before"?: ((call: ToolInvocation) => Effect.Effect<void, unknown, R>) | undefined
  readonly "tool.after"?: ((call: ToolInvocation, result: CallResult) => Effect.Effect<void, never, R>) | undefined
  readonly "extension.before"?: ((call: ExtensionInvocation) => Effect.Effect<void, unknown, R>) | undefined
  readonly "extension.after"?:
    | ((call: ExtensionInvocation, result: CallResult) => Effect.Effect<void, never, R>)
    | undefined
}

/** Runs `before`, then `run`, then `after` with how it ended, including when interrupted. */
export const hooked = <Call, A, R>(
  call: Call,
  before: ((call: Call) => Effect.Effect<void, unknown, R>) | undefined,
  after: ((call: Call, result: CallResult) => Effect.Effect<void, never, R>) | undefined,
  run: Effect.Effect<A, unknown, R>,
): Effect.Effect<A, unknown, R> => {
  const observed =
    after === undefined
      ? run
      : Effect.onExit(run, (exit) => {
          if (Exit.isSuccess(exit)) return after(call, { status: "success", value: exit.value })
          if (Cause.hasInterruptsOnly(exit.cause)) return after(call, { status: "interrupted" })
          return after(call, { status: "failure", error: Cause.squash(exit.cause) })
        })
  return before === undefined ? observed : Effect.andThen(before(call), observed)
}

export type ToolDescription = {
  readonly path: string
  readonly description: string
  readonly signature: string
}

const defaultSearchLimit = 10
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
const SearchInput = Schema.Struct({
  query: Schema.optionalKey(Schema.String),
  namespace: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(PositiveInt),
  offset: Schema.optionalKey(NonNegativeInt),
})
// A guest query is ranked against the entire host catalog before the VM can yield again.
const luaSearchLength = 512
const luaSearchText = Schema.String.check(Schema.isMaxLength(luaSearchLength))
const LuaSearchInput = Schema.Struct({
  query: Schema.optionalKey(luaSearchText),
  namespace: Schema.optionalKey(luaSearchText),
  limit: Schema.optionalKey(PositiveInt.check(Schema.isLessThanOrEqualTo(50))),
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
export const toolExpression = (path: string, language: Language = "javascript") =>
  "tools" +
  path
    .split(".")
    .map((segment) => member(segment, language))
    .join("")

export class ToolReference {
  constructor(readonly path: ReadonlyArray<string>) {}
}

// Dots in tool names are namespace separators; the last tool for a canonical path wins.
type ToolNode<R> = {
  tool?: Tool<R>
  namespace?: Namespace<R>
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
      else if (isNamespace<R>(value)) {
        current.namespace = value
        insert(current, value.tools)
      } else insert(current, value)
    }
  }
  insert(root, tools)
  return root
}

const canonicalSegments = (path: ReadonlyArray<string>): ReadonlyArray<string> =>
  path.flatMap((segment) => segment.split("."))

type VisibleTool<R> = {
  readonly path: string
  readonly tool: Tool<R>
  readonly namespaces: ReadonlyArray<Namespace<R>>
}

const flattenTools = <R>(
  node: ToolNode<R>,
  path: ReadonlyArray<string> = [],
  namespaces: ReadonlyArray<Namespace<R>> = [],
): Array<VisibleTool<R>> => {
  const next = node.namespace === undefined ? namespaces : [...namespaces, node.namespace]
  return [
    ...(node.tool === undefined ? [] : [{ path: path.join("."), tool: node.tool, namespaces: next }]),
    ...Array.from(node.children).flatMap(([name, child]) => flattenTools(child, [...path, name], next)),
  ]
}

const describeTool = <R>(visible: VisibleTool<R>, language: Language): ToolDescription => {
  let signature: string | undefined
  return {
    path: visible.path,
    description: visible.tool.description,
    get signature() {
      // Search ranks paths and descriptions first; only returned matches need their schemas rendered.
      // Joining the final fragments avoids retaining the rendering's intermediate string ropes in JSC.
      return (signature ??= signatureOf(toolExpression(visible.path, language), visible.tool, language))
    },
  }
}

/** Tools indexed once per runtime, with discovery materialized on demand. */
export type Prepared<R = never> = {
  readonly language: Language
  readonly root: ToolNode<R>
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly searchIndex: ReadonlyArray<SearchEntry>
}

export type SearchEntry = {
  readonly description: ToolDescription
  /** The path split into words, so `zones` matches `get_zones` as a word rather than as a substring of `timezones`. */
  readonly pathWords: ReadonlyArray<string>
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

const rank = (entries: ReadonlyArray<SearchEntry>, query: string, language: Language): Array<SearchEntry> => {
  const words = tokenize(query)
  const terms = (language === "lua" ? words.slice(0, 16) : words).map(termForms)
  return entries
    .map((entry) => {
      const path = entry.description.path.toLowerCase()
      const description = entry.description.description.toLowerCase()
      const score = terms.reduce(
        (total, forms) =>
          total +
          (forms.some((form) => path === form || path.endsWith(`.${form}`)) ? 20 : 0) +
          (forms.some((form) => entry.pathWords.includes(form)) ? 12 : 0) +
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
}

const makeSearchTool = (searchIndex: ReadonlyArray<SearchEntry>, language: Language): Tool => ({
  _tag: "CodeModeTool",
  description: "Search available tools",
  input: language === "lua" ? LuaSearchInput : SearchInput,
  output: SearchOutput,
  execute: (input) =>
    Effect.sync(() => {
      const request = input as typeof SearchInput.Type
      const query = request.query ?? ""
      const offset = request.offset ?? 0
      let ns = request.namespace
      if (ns !== undefined && !searchIndex.some((entry) => entry.description.path.startsWith("tools."))) {
        if (ns === "tools") ns = undefined
        else if (ns.startsWith("tools.")) ns = ns.slice("tools.".length)
      }
      const scoped =
        ns === undefined
          ? searchIndex
          : searchIndex.filter((entry) => entry.description.path === ns || entry.description.path.startsWith(`${ns}.`))
      const trimmed = query.trim()
      const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice("tools.".length) : trimmed
      const exact =
        pathQuery === ""
          ? undefined
          : scoped.find(
              (entry) =>
                entry.description.path === pathQuery || toolExpression(entry.description.path, language) === trimmed,
            )
      const ranked = exact !== undefined ? [exact] : rank(scoped, query, language)
      const items = ranked.slice(offset, offset + (request.limit ?? defaultSearchLimit)).map(({ description }) => ({
        ...description,
        path: toolExpression(description.path, language),
      }))
      const remaining = Math.max(0, ranked.length - offset - items.length)
      return {
        items,
        remaining,
        next: remaining > 0 ? { offset: offset + items.length } : null,
      }
    }),
})

function signatureOf<R>(name: string, tool: Tool<R>, language: Language, global = false) {
  const input = isEmptyInput(tool) ? "" : inputType(tool, true, language)
  const output = outputType(tool, true, language)
  return [
    name,
    "(",
    input,
    ")",
    language === "lua" ? ` -> ${output}` : global ? `: ${output}` : `: Promise<${output}>`,
  ].join("")
}

/** Exact callable signatures of the built-in `search` function, for host-owned instructions. */
export const searchSignature = signatureOf("search", makeSearchTool([], "javascript"), "javascript", true)
export const luaSearchSignature = signatureOf("search", makeSearchTool([], "lua"), "lua", true)

const toSearchEntry = <R>(visible: VisibleTool<R>, language: Language): SearchEntry => ({
  description: describeTool(visible, language),
  pathWords: tokenize(visible.path),
  searchText: [
    visible.path,
    visible.tool.description,
    ...visible.namespaces.flatMap((namespace) => (namespace.description === undefined ? [] : [namespace.description])),
    ...inputProperties(visible.tool).flatMap(({ name, description: property }) =>
      property === undefined ? [name] : [name, property],
    ),
  ]
    .join("\n")
    .toLowerCase(),
})

export const prepare = <R>(tools: Tools<R>, language: Language = "javascript"): Prepared<R> => {
  const root = toolTrie(tools)
  let searchIndex: ReadonlyArray<SearchEntry> | undefined
  let catalog: ReadonlyArray<ToolDescription> | undefined
  return {
    language,
    root,
    get catalog() {
      return (catalog ??= this.searchIndex.map((entry) => entry.description))
    },
    get searchIndex() {
      // Executing known tools only needs the trie. Render discovery when it is actually read,
      // ordering after canonical-path collisions settle so instruction bytes stay deterministic.
      return (searchIndex ??= flattenTools(root)
        .sort((left, right) => compareText(left.path, right.path))
        .map((visible) => toSearchEntry(visible, language)))
    },
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

const resolve = <R>(prepared: Prepared<R>, path: ReadonlyArray<string>): Tool<R> => {
  const segments = canonicalSegments(path)
  const node = lookup(prepared.root, segments)
  if (node === undefined) {
    const name = segments.join(".")
    if (prepared.language === "lua" && name.length > luaSearchLength)
      throw new ToolRuntimeError("UnknownTool", "Unknown tool (path too long for suggestions).", [
        "Use search to find available tools.",
      ])
    const ns = segments.length > 1 && prepared.root.children.has(segments[0]) ? segments[0] : undefined
    const index = prepared.searchIndex
    const closest = rank(
      ns ? index.filter((entry) => entry.description.path.startsWith(`${ns}.`)) : index,
      ns ? segments.slice(1).join(" ") : name,
      prepared.language,
    )[0]
    throw new ToolRuntimeError(
      "UnknownTool",
      closest
        ? `Unknown tool '${name}'. Did you mean ${toolExpression(closest.description.path, prepared.language)}?`
        : `Unknown tool '${name}'.`,
      ["Use search to find available tools."],
    )
  }
  if (node.tool === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Tool '${segments.join(".")}' is not callable.`)
  }
  return node.tool
}

// Errors can be observed by hooks before the Lua driver sees them. Keep the
// budget marker outside the value so rewriting an error can't make it catchable.
const budgetFailures = new WeakSet<object>()
export const isBudgetFailure = (error: unknown) =>
  typeof error === "object" && error !== null && budgetFailures.has(error)

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind: Extract<
      DiagnosticKind,
      "UnknownTool" | "InvalidToolInput" | "InvalidToolOutput" | "ToolCallLimitExceeded"
    >,
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
    fatal = false,
  ) {
    super(message)
    this.name = "ToolRuntimeError"
    if (fatal || kind === "ToolCallLimitExceeded") budgetFailures.add(this)
  }
}

/** The tool bridge of one execution. Arguments arrive and results leave as JSON; program values never enter. */
export type ToolRuntime<R = never> = {
  readonly calls: Array<ToolCall>
  /** Charge a non-tool host capability against this execution's call budget. */
  readonly admit: () => void
  readonly hooks: Hooks<R>
  readonly execute: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
  ) => Effect.Effect<Json | undefined, unknown, R>
  readonly search: (args: Array<Json | undefined>) => Effect.Effect<Json | undefined, unknown, R>
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
}

/** Per-execution call state over tools prepared once for the runtime. */
export const make = <R>(
  prepared: Prepared<R>,
  maxToolCalls: number | undefined,
  hooks: Hooks<R> = {},
  boundary?: {
    copy: (value: unknown) => Json | undefined
    message: (error: unknown, fallback?: string) => string
    isLimit: (error: unknown) => boolean
  },
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  const root = prepared.root

  let admitted = 0
  const admit = (): void => {
    if (maxToolCalls !== undefined && admitted >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    admitted++
  }

  const executeTool = (name: string, tool: Tool<R>, args: Array<Json | undefined>) =>
    Effect.gen(function* () {
      const normalized = args.length === 0 ? [{}] : args
      if (normalized.length !== 1)
        throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects at most one input object.`)
      const input = yield* Effect.try({
        try: () => decodeToolInput(tool, normalized[0]),
        catch: (cause) =>
          new ToolRuntimeError(
            "InvalidToolInput",
            `Invalid input for tool '${name}': ${boundary ? boundary.message(cause, "Value does not match the input schema.") : String(cause)}`,
            name === "search" ? [] : ["The signature may have changed. Use search to get the current signature."],
          ),
      })
      if (!boundary) admit()
      calls.push({ name })
      const after = hooks["tool.after"]
      return yield* hooked(
        { name, input },
        hooks["tool.before"],
        // Do not give a hook a reference to data the suspended Lua VM will import.
        boundary && after
          ? (call, result) =>
              after(call, result.status === "success" ? { ...result, value: boundary.copy(result.value) } : result)
          : after,
        Effect.gen(function* () {
          const raw = yield* Effect.suspend(() => tool.execute(input)).pipe(
            Effect.catchCause((cause) => {
              if (boundary ? Cause.hasInterrupts(cause) : Cause.hasInterruptsOnly(cause)) return Effect.interrupt
              if (boundary) return Effect.fail(toolError(boundary.message(Cause.squash(cause))))
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
            try: (): Json | undefined => {
              // A schema decoder can traverse the entire value (and may transform it).
              // Confined Lua requires bounded plain data on both sides of that decoder.
              if (boundary) return boundary.copy(decodeToolOutput(tool, boundary.copy(raw)))
              // Preserve the JavaScript bridge's JSON.stringify semantics.
              const text = JSON.stringify(decodeToolOutput(tool, raw))
              return text === undefined ? undefined : JSON.parse(text)
            },
            catch: (cause) =>
              new ToolRuntimeError(
                "InvalidToolOutput",
                `Invalid output from tool '${name}': ${boundary ? boundary.message(cause, "Value does not match the output schema.") : String(cause)}`,
                [],
                boundary?.isLimit(cause),
              ),
          })
        }),
      )
    })

  return {
    calls,
    admit,
    hooks,
    keys: (path) => namespaceKeys(root, path),
    search: (args) =>
      Effect.suspend(() => {
        if (boundary) admit()
        return executeTool("search", makeSearchTool(prepared.searchIndex, prepared.language), args)
      }),
    execute: (path, args) =>
      Effect.suspend(() => {
        // Even a failed lookup ranks the catalog. In Lua, pcall can repeat it.
        if (boundary) admit()
        const segments = canonicalSegments(path)
        // Models often write `tools.search(...)` for the bare `search(...)`; honor it unless a tool owns that path.
        if (segments.length === 1 && segments[0] === "search" && lookup(root, segments) === undefined)
          return executeTool("search", makeSearchTool(prepared.searchIndex, prepared.language), args)
        return executeTool(segments.join("."), resolve(prepared, path), args)
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
