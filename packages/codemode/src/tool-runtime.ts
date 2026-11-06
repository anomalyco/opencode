import { Cause, Effect, Exit, Formatter, Schema } from "effect"
import type { Json } from "./data.js"
import type { DiagnosticKind } from "./codemode.js"
import { toolError } from "./tool-error.js"
import { SuspendError } from "./suspend-error.js"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  identifierSegment,
  inputProperties,
  inputTypeScript,
  isEmptyInput,
  outputTypeScript,
} from "./tool-schema.js"
import { isNamespace, type Namespace } from "./namespace.js"
import { type Handle, isTool, type Tool } from "./tool.js"
import type { Tools } from "./tools.js"

export const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

export type Services<T> = ServicesOf<T, []>

type ServicesOf<T, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : T extends {
        readonly _tag: "CodeModeTool"
        readonly execute: (
          input: unknown,
          context?: { readonly key: string },
        ) => Effect.Effect<unknown, unknown, infer R>
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
export type ToolInvocation = {
  readonly name: string
  readonly input: unknown
  /** The call's idempotency key, `<run id>:<call id>`: the same at every hook, and across a suspended run's resumes. */
  readonly key?: string
}

const invocation = (name: string, input: unknown, key: string): ToolInvocation => {
  const call = { name, input } as ToolInvocation
  Object.defineProperty(call, "key", { value: key, enumerable: false })
  return call
}

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
  const observed = after === undefined ? run : Effect.onExit(run, (exit) => after(call, callResult(exit)))
  return before === undefined ? observed : Effect.andThen(before(call), observed)
}

const callResult = (exit: Exit.Exit<unknown, unknown>): CallResult => {
  if (Exit.isSuccess(exit)) return { status: "success", value: exit.value }
  if (Cause.hasInterruptsOnly(exit.cause)) return { status: "interrupted" }
  return { status: "failure", error: Cause.squash(exit.cause) }
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

const describeTool = <R>(visible: VisibleTool<R>): ToolDescription => {
  let signature: string | undefined
  return {
    path: visible.path,
    description: visible.tool.description,
    get signature() {
      // Search ranks paths and descriptions first; only returned matches need their schemas rendered.
      // Joining the final fragments avoids retaining the rendering's intermediate string ropes in JSC.
      return (signature ??= [
        toolExpression(visible.path),
        isEmptyInput(visible.tool) ? "()" : `(${inputTypeScript(visible.tool, true)})`,
        `: Promise<${outputTypeScript(visible.tool, true)}>`,
      ].join(""))
    },
  }
}

/** Tools indexed once per runtime, with discovery materialized on demand. */
export type Prepared<R = never> = {
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

const rank = (entries: ReadonlyArray<SearchEntry>, query: string): Array<SearchEntry> => {
  const terms = tokenize(query).map(termForms)
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
              (entry) => entry.description.path === pathQuery || toolExpression(entry.description.path) === trimmed,
            )
      const ranked = exact !== undefined ? [exact] : rank(scoped, query)
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
  return `search(${inputTypeScript(tool, true)}): ${outputTypeScript(tool, true)}`
})()

const toSearchEntry = <R>(visible: VisibleTool<R>): SearchEntry => ({
  description: describeTool(visible),
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

export const prepare = <R>(tools: Tools<R>): Prepared<R> => {
  const root = toolTrie(tools)
  let searchIndex: ReadonlyArray<SearchEntry> | undefined
  let catalog: ReadonlyArray<ToolDescription> | undefined
  return {
    root,
    get catalog() {
      return (catalog ??= this.searchIndex.map((entry) => entry.description))
    },
    get searchIndex() {
      // Executing known tools only needs the trie. Render discovery when it is actually read,
      // ordering after canonical-path collisions settle so instruction bytes stay deterministic.
      return (searchIndex ??= flattenTools(root)
        .sort((left, right) => compareText(left.path, right.path))
        .map(toSearchEntry))
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

const resolve = <R>(root: ToolNode<R>, path: ReadonlyArray<string>, index: ReadonlyArray<SearchEntry>): Tool<R> => {
  const segments = canonicalSegments(path)
  const node = lookup(root, segments)
  if (node === undefined) {
    const name = segments.join(".")
    const ns = segments.length > 1 && root.children.has(segments[0]) ? segments[0] : undefined
    const closest = rank(
      ns ? index.filter((entry) => entry.description.path.startsWith(`${ns}.`)) : index,
      ns ? segments.slice(1).join(" ") : name,
    )[0]
    throw new ToolRuntimeError(
      "UnknownTool",
      closest
        ? `Unknown tool '${name}'. Did you mean ${toolExpression(closest.description.path)}?`
        : `Unknown tool '${name}'.`,
      ["Use search to find available tools."],
    )
  }
  if (node.tool === undefined) {
    throw new ToolRuntimeError("UnknownTool", `Tool '${segments.join(".")}' is not callable.`)
  }
  return node.tool
}

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind: Extract<
      DiagnosticKind,
      "UnknownTool" | "InvalidToolInput" | "InvalidToolOutput" | "ToolCallLimitExceeded"
    >,
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "ToolRuntimeError"
  }
}

/** The tool bridge of one execution. Arguments arrive and results leave as JSON; program values never enter. */
export type ToolRuntime<R = never> = {
  readonly calls: Array<ToolCall>
  readonly hooks: Hooks<R>
  /** Runs a tool call under its idempotency `key`. */
  readonly execute: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    key?: string,
  ) => Effect.Effect<Json | undefined, unknown, R>
  readonly search: (args: Array<Json | undefined>, key?: string) => Effect.Effect<Json | undefined, unknown, R>
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  /** The tool at `path`, if there is one, so a caller can see whether it is durable. */
  readonly tool: (path: ReadonlyArray<string>) => Tool<R> | undefined
  /** Admits a call to a durable tool, as `execute` does, and starts its work under `key`: its handle. */
  /** `suspend` is what the tool's `ctx.suspend` does: suspends the run for this call. */
  readonly start: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    key: string,
    suspend: Effect.Effect<never, SuspendError>,
  ) => Effect.Effect<Handle, unknown, R>
  /**
   * Waits for a durable tool's work: its output, as `execute` gives it. Interrupting it detaches. `detaching` says
   * whether an interruption detaches to suspend the run, which `tool.after` doesn't see, or ends the call, which it
   * sees as interrupted.
   */
  readonly attach: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    key: string,
    handle: Handle,
    detaching: () => boolean,
    suspend: Effect.Effect<never, SuspendError>,
  ) => Effect.Effect<Json | undefined, unknown, R>
  /** Stops a durable tool's work. */
  readonly cancel: (path: ReadonlyArray<string>, handle: Handle) => Effect.Effect<void, unknown, R>
}

const notDurable = Effect.fail(new SuspendError({ message: "Only a durable tool can suspend its run.", running: [] }))

/** Per-execution call state over tools prepared once for the runtime. */
export const make = <R>(
  prepared: Prepared<R>,
  maxToolCalls: number | undefined,
  hooks: Hooks<R> = {},
  calls: Array<ToolCall> = [],
): ToolRuntime<R> => {
  const root = prepared.root

  const recordCall = (call: ToolCall): void => {
    if (maxToolCalls !== undefined && calls.length >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    calls.push(call)
  }

  const decode = (name: string, tool: Tool<R>, args: Array<Json | undefined>) =>
    Effect.gen(function* () {
      const normalized = args.length === 0 ? [{}] : args
      if (normalized.length !== 1)
        throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects at most one input object.`)
      return yield* Effect.try({
        try: () => decodeToolInput(tool, normalized[0]),
        catch: (cause) =>
          new ToolRuntimeError(
            "InvalidToolInput",
            `Invalid input for tool '${name}': ${String(cause)}`,
            name === "search" ? [] : ["The signature may have changed. Use search to get the current signature."],
          ),
      })
    })

  // A tool's own failure becomes a ToolError; interruption passes through.
  const failure = <A>(effect: Effect.Effect<A, unknown, R>) =>
    effect.pipe(
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

  // The same round trip a tool result would take through text: exact JSON.stringify semantics.
  const output = (name: string, tool: Tool<R>, raw: unknown) =>
    Effect.try({
      try: (): Json | undefined => {
        const text = JSON.stringify(decodeToolOutput(tool, raw))
        return text === undefined ? undefined : JSON.parse(text)
      },
      catch: (cause) => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}': ${cause}`),
    })

  const executeTool = (name: string, tool: Tool<R>, args: Array<Json | undefined>, key: string = crypto.randomUUID()) =>
    Effect.gen(function* () {
      const input = yield* decode(name, tool, args)
      yield* Effect.sync(() => recordCall({ name }))
      return yield* hooked(
        invocation(name, input, key),
        hooks["tool.before"],
        hooks["tool.after"],
        Effect.gen(function* () {
          // Only a durable tool can suspend its run; the context type leaves `suspend` out, and calling it fails.
          const context = { key, suspend: notDurable }
          const raw = yield* failure(Effect.suspend(() => tool.execute(input, context)))
          return yield* output(name, tool, raw)
        }),
      )
    })

  const durableTool = (path: ReadonlyArray<string>) => {
    const segments = canonicalSegments(path)
    const name = segments.join(".")
    const tool = lookup(root, segments)?.tool
    if (tool?.durable === undefined) throw new TypeError(`Tool '${name}' is not durable.`)
    return { name, tool, durable: tool.durable }
  }

  return {
    calls,
    hooks,
    keys: (path) => namespaceKeys(root, path),
    search: (args, key) => Effect.suspend(() => executeTool("search", makeSearchTool(prepared.searchIndex), args, key)),
    execute: (path, args, key) =>
      Effect.suspend(() => {
        const segments = canonicalSegments(path)
        // Models often write `tools.search(...)` for the bare `search(...)`; honor it unless a tool owns that path.
        if (segments.length === 1 && segments[0] === "search" && lookup(root, segments) === undefined)
          return executeTool("search", makeSearchTool(prepared.searchIndex), args, key)
        return executeTool(segments.join("."), resolve(root, path, prepared.searchIndex), args, key)
      }),
    tool: (path) => lookup(root, canonicalSegments(path))?.tool,
    start: (path, args, key, suspend) =>
      Effect.suspend(() => {
        const found = durableTool(path)
        return Effect.gen(function* () {
          const input = yield* decode(found.name, found.tool, args)
          yield* Effect.sync(() => recordCall({ name: found.name }))
          const before = hooks["tool.before"]
          if (before !== undefined) yield* before(invocation(found.name, input, key))
          return yield* failure(Effect.suspend(() => found.durable.start(input, { key, suspend })))
        })
      }),
    attach: (path, args, key, handle, detaching, suspend) =>
      Effect.suspend(() => {
        const found = durableTool(path)
        const after = hooks["tool.after"]
        const run = Effect.gen(function* () {
          const raw = yield* failure(Effect.suspend(() => found.durable.attach(handle, { key, suspend })))
          return yield* output(found.name, found.tool, raw)
        })
        if (after === undefined) return run
        // Detaching to suspend is not an outcome: `after` sees how the work ended, once it has.
        return Effect.flatMap(decode(found.name, found.tool, args), (input) =>
          Effect.onExit(run, (exit) => {
            const result = callResult(exit)
            if (result.status === "interrupted" && detaching()) return Effect.void
            return after(invocation(found.name, input, key), result)
          }),
        )
      }),
    cancel: (path, handle) => Effect.suspend(() => failure(durableTool(path).durable.cancel(handle))),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
