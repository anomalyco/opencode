import { Cause, Effect } from "effect"
import { ToolError, toolError } from "./tool-error.js"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  inputProperties,
  inputTypeScript,
  isDefinition as isToolDefinition,
  outputTypeScript,
  type Definition,
} from "./tool.js"
import { SandboxDate, SandboxMap, SandboxPromise, SandboxRegExp, SandboxSet } from "./values.js"

export type HostTool<R = never> = (...args: Array<unknown>) => Effect.Effect<unknown, unknown, R>

export type HostTools<R = never> = {
  [name: string]: HostTool<R> | Definition<R> | HostTools<R>
}

export type Services<Tools> = Tools extends (...args: Array<unknown>) => Effect.Effect<unknown, unknown, infer R>
  ? R
  : Tools extends { readonly _tag: "CodeModeTool"; readonly run: (input: unknown) => Effect.Effect<unknown, unknown, infer R> }
    ? R
  : Tools extends object
    ? string extends keyof Tools ? never : Services<Tools[keyof Tools]>
    : never

/** Minimal audit record retained for each admitted tool call. */
export type ToolCall = {
  readonly name: string
}

/** Decoded tool call observed immediately before tool execution. */
export type ToolCallStarted = {
  readonly index: number
  readonly name: string
  readonly input: unknown
}

/** Completed tool call observed immediately after tool execution settles. */
export type ToolCallEnded = {
  readonly index: number
  readonly name: string
  readonly input: unknown
  readonly durationMs: number
  readonly outcome: "success" | "failure"
  /** Model-safe failure message; present only when `outcome` is `"failure"`. */
  readonly message?: string
}

/** Non-throwing observation hooks fired around each admitted tool call. */
export type ToolCallHooks<R = never> = {
  readonly onToolCallStart?: ((call: ToolCallStarted) => Effect.Effect<void, never, R>) | undefined
  readonly onToolCallEnd?: ((call: ToolCallEnded) => Effect.Effect<void, never, R>) | undefined
}

/** Model-visible description of one schema-backed tool. */
export type ToolDescription = {
  readonly path: string
  readonly description: string
  readonly signature: string
}

export type SafeObject = Record<string, unknown>

const reservedNamespace = "$codemode"
const defaultMaxInlineCatalogBytes = 16_000
const defaultSearchLimit = 10
const searchSignature = "tools.$codemode.search({ query?: string, namespace?: string, limit?: number }): Promise<{ items: Array<{ path: string; description: string; signature: string }>; total: number }>"

export class ToolReference {
  constructor(readonly path: ReadonlyArray<string>) {}
}

export type DataLimits = {
  readonly maxValueDepth: number
  readonly maxCollectionLength: number
  readonly maxDataBytes: number
  readonly maxAuditBytes: number
}

export class ToolRuntimeError extends Error {
  constructor(
    readonly kind: "UnknownTool" | "InvalidToolInput" | "InvalidToolOutput" | "InvalidDataValue" | "ToolCallLimitExceeded" | "AuditLimitExceeded",
    message: string,
    readonly suggestions: ReadonlyArray<string> = [],
  ) {
    super(message)
    this.name = "ToolRuntimeError"
  }
}

const isDefinition = <R>(value: HostTool<R> | Definition<R> | HostTools<R>): value is Definition<R> =>
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

export const copyIn = (value: unknown, label: string, limits?: DataLimits, depth = 0, seen = new Set<object>()): unknown => {
  if (limits && depth > limits.maxValueDepth) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${limits.maxValueDepth}.`)
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    // NaN/Infinity are allowed to exist as in-sandbox intermediates (matching real JS and a real
    // engine) so defensive guards like `Number.isNaN(x)` / `parseInt(x) || 0` can run. They are
    // normalized to `null` when the value leaves the sandbox — see copyOut — exactly as
    // JSON.stringify already does at any tool boundary.
    typeof value === "number"
  ) {
    return value
  }

  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }

  // An un-awaited promise never crosses a data boundary as `{}`; the diagnostic tells the
  // model exactly how to fix the program instead.
  if (value instanceof SandboxPromise) {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains an un-awaited Promise; await tool calls (e.g. \`const result = await tools.ns.tool(...)\`) before using their results.`,
    )
  }

  // Sandbox value types (and their host counterparts, which a host tool may legitimately
  // return) serialize exactly as JSON.stringify would at every data checkpoint: a Date is its
  // toJSON() ISO string (invalid -> null), and RegExp/Map/Set have no JSON form beyond {}.
  if (value instanceof SandboxDate) {
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (
    value instanceof SandboxRegExp || value instanceof SandboxMap || value instanceof SandboxSet ||
    value instanceof RegExp || value instanceof Map || value instanceof Set
  ) {
    return Object.create(null) as SafeObject
  }

  if (seen.has(value)) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} contains a circular value.`)
  }

  seen.add(value)

  if (Array.isArray(value)) {
    if (limits && value.length > limits.maxCollectionLength) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`)
    }
    const copied = value.map((item) => copyIn(item, label, limits, depth + 1, seen))
    seen.delete(value)
    return copied
  }

  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain plain objects only.`)
  }

  const copied: SafeObject = Object.create(null) as SafeObject
  const entries = Object.entries(value)
  if (limits && entries.length > limits.maxCollectionLength) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum collection length of ${limits.maxCollectionLength}.`)
  }
  for (const [key, item] of entries) {
    if (isBlockedMember(key)) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} contains blocked property '${key}'.`)
    }
    copied[key] = copyIn(item, label, limits, depth + 1, seen)
  }
  seen.delete(value)
  return copied
}

export const copyOut = (value: unknown, undefinedAsNull = false): unknown => {
  if (value === undefined && undefinedAsNull) return null
  // Normalize non-finite numbers to null as the value crosses out of the sandbox (final return
  // and tool-call arguments both funnel through here), matching JSON semantics — NaN/Infinity
  // have no JSON representation, so JSON.stringify would produce null anyway.
  if (typeof value === "number" && !Number.isFinite(value)) {
    return null
  }
  if (Array.isArray(value)) {
    return value.map((item) => copyOut(item, undefinedAsNull))
  }

  if (value !== null && typeof value === "object" && !(value instanceof ToolReference)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyOut(item, undefinedAsNull)]))
  }

  return value
}

const definitions = <R>(tools: HostTools<R>, path: ReadonlyArray<string> = []): Array<{ path: string; definition: Definition<R> }> => {
  const entries: Array<{ path: string; definition: Definition<R> }> = []
  for (const [name, value] of Object.entries(tools)) {
    const next = [...path, name]
    if (isDefinition(value)) entries.push({ path: next.join("."), definition: value })
    else if (typeof value !== "function") entries.push(...definitions(value, next))
  }
  return entries
}

const describeDefinition = <R>(path: string, definition: Definition<R>): ToolDescription => ({
    path,
    description: definition.description,
    signature: `tools.${path}(input: ${inputTypeScript(definition)}): Promise<${outputTypeScript(definition)}>`,
  })

const visibleDefinitions = <R>(tools: HostTools<R>) =>
  definitions(tools).flatMap(({ path, definition }) => {
    const description = describeDefinition(path, definition)
    return [{ path, definition, description }]
  })

export const catalog = <R>(tools: HostTools<R>): ReadonlyArray<ToolDescription> =>
  visibleDefinitions(tools).map(({ description }) => description)

export type DiscoveryPlan = {
  readonly catalog: ReadonlyArray<ToolDescription>
  readonly instructions: string
  readonly searchIndex: ReadonlyArray<SearchEntry>
}

export type SearchEntry = {
  readonly description: ToolDescription
  /** Top-level namespace (first path segment), matched by the search `namespace` option. */
  readonly namespace: string
  /** Lowercased path + description + input property names/descriptions, for substring matching. */
  readonly searchText: string
}

const utf8ByteLength = (value: string) => new TextEncoder().encode(value).byteLength

/**
 * Split a query into lowercased search terms. camelCase boundaries are split
 * (`resolveLibrary` -> `resolve library`) and every non-alphanumeric character is a
 * separator, so `resolve-library-id`, `resolveLibraryId`, and `resolve library id` all
 * tokenize alike. Empties and the `*` wildcard are dropped.
 */
const tokenize = (query: string): Array<string> =>
  query
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 0 && term !== "*")

const firstLine = (text: string) => text.split("\n", 1)[0]!.trim()

/** One-line description used on inline catalog lines; the full text stays in search results. */
const brief = (text: string, max = 120) => {
  const line = firstLine(text)
  return line.length > max ? line.slice(0, max - 1) + "…" : line
}

const catalogLine = (tool: ToolDescription) => {
  const description = brief(tool.description)
  return description === "" ? `  - ${tool.signature}` : `  - ${tool.signature} // ${description}`
}

const toSearchEntry = <R>(path: string, definition: Definition<R>, description: ToolDescription): SearchEntry => ({
  description,
  namespace: path.split(".", 1)[0]!,
  searchText: [
    path,
    definition.description,
    ...inputProperties(definition).flatMap(({ name, description: property }) =>
      property === undefined ? [name] : [name, property]),
  ].join("\n").toLowerCase(),
})

/** The runtime search index over every described tool. Search is always registered. */
export const searchIndex = <R>(tools: HostTools<R>): ReadonlyArray<SearchEntry> =>
  visibleDefinitions(tools).map(({ path, definition, description }) => toSearchEntry(path, definition, description))

export const assertValidTools = <R>(tools: HostTools<R>): void => {
  if (Object.hasOwn(tools, reservedNamespace)) {
    throw new Error(`Tool namespace '${reservedNamespace}' is reserved for CodeMode discovery tools.`)
  }
}

/**
 * Budgeted catalog: every namespace is always listed with its tool count; full call
 * signatures are inlined cheapest-first within each namespace (namespaces processed
 * alphabetically) until `maxInlineCatalogBytes` is used, and the section states exactly
 * how comprehensive it is — overall (COMPLETE vs PARTIAL) and per namespace.
 */
export const discoveryPlan = <R>(
  tools: HostTools<R>,
  maxInlineCatalogBytes = defaultMaxInlineCatalogBytes,
): DiscoveryPlan => {
  if (!Number.isSafeInteger(maxInlineCatalogBytes) || maxInlineCatalogBytes < 0) {
    throw new RangeError("discovery.maxInlineCatalogBytes must be a non-negative safe integer")
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

  // Select which signatures fit the budget (cheapest first within each namespace,
  // namespaces alphabetical) before emitting, so the list can state exactly how
  // comprehensive it is. Once one line does not fit, inlining stops for every
  // remaining namespace — later namespaces show counts only.
  const shown = new Map<string, ReadonlySet<ToolDescription>>()
  let used = 0
  let budgetLeft = true
  let totalShown = 0
  for (const [namespace, group] of ordered) {
    const picked = new Set<ToolDescription>()
    if (budgetLeft) {
      const cheapestFirst = [...group].sort(
        (left, right) => utf8ByteLength(catalogLine(left)) - utf8ByteLength(catalogLine(right)) || left.path.localeCompare(right.path),
      )
      for (const tool of cheapestFirst) {
        const cost = utf8ByteLength(catalogLine(tool)) + 1
        if (used + cost > maxInlineCatalogBytes) {
          budgetLeft = false
          break
        }
        picked.add(tool)
        used += cost
      }
    }
    shown.set(namespace, picked)
    totalShown += picked.size
  }
  const complete = totalShown === described.length

  const empty = described.length === 0

  // Section order is deliberate: workflow first (the top is the least likely part of a long
  // description to be truncated or skimmed away), then rules, then syntax, with the budgeted
  // catalog at the bottom. Every call form uses explicit `<namespace>.<tool>` placeholders —
  // never a real or fabricated tool name.
  const intro = [
    "Write a CodeMode program to answer the request. Return code only.",
    empty
      ? "Execute JavaScript in a confined runtime."
      : "Execute JavaScript in a confined runtime with access to the tools listed below under `tools.*`.",
  ]

  // The search step exists only when search is advertised (PARTIAL catalog); a COMPLETE
  // catalog already shows every signature, so step 1 picks from the list instead.
  const workflow = empty
    ? []
    : [
        "",
        "## Workflow",
        "",
        ...(complete
          ? [
              "1. Pick a tool from the list under `## Available tools` — each line is the exact call signature, followed by the tool's description.",
              "2. Call it by path: `const res = await tools.<namespace>.<tool>(input)`",
              '3. Parse text results: `const data = typeof res === "string" ? JSON.parse(res) : res`',
              "4. Return only what you need: `return { <field>: data.<field> }`",
            ]
          : [
              '1. Find a tool (skip when it is already listed below): `const { items } = await tools.$codemode.search({ query: "<intent + key nouns>" })`',
              "2. Read the matches: each item is `{ path, description, signature }` — the signature is the exact call form; read the description before using an unfamiliar tool.",
              "3. Call it by path: `const res = await tools.<namespace>.<tool>(input)`",
              '4. Parse text results: `const data = typeof res === "string" ? JSON.parse(res) : res`',
              "5. Return only what you need: `return { <field>: data.<field> }`",
            ]),
      ]

  const rules = empty
    ? []
    : [
        "",
        "## Rules",
        "",
        complete
          ? "- Call a tool by its path: `await tools.<namespace>.<tool>(input)`. The signatures listed below are exact — use them as-is rather than guessing segments."
          : "- Call a tool by its path: `await tools.<namespace>.<tool>(input)`. The `path` in search results is exact — use it as-is rather than guessing segments.",
        "- Most tools return TEXT that is actually JSON — if a result is a string, JSON.parse it before reading fields.",
        "- Return small: extract only the fields you need. Do NOT return raw or large tool payloads — they get truncated and waste context.",
        "- Filter, aggregate, and transform large collections in code instead of returning them or calling per-item tools one message at a time.",
        "- Inspect intermediate values with console.log/warn/error/dir/table — logs come back with the result; `return` only the final, minimal answer.",
        "- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))` (allSettled/race/resolve/reject also work). No .then/.catch — use await with try/catch.",
        "- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.",
        ...(complete ? [] : ['- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.']),
        "- Files/images produced by tools never enter the program — they are attached to the final result automatically; a call that returns only media yields a small text marker instead, and your returned value plus logs is what the model reads.",
      ]

  const syntax = [
    "",
    "## Syntax",
    "",
    "Common syntax: arrow functions and `function` declarations (hoisted) with closures, default/rest parameters, destructuring (incl. rest/defaults), optional chaining, template literals, conditionals, switch, loops (for...of over arrays/strings/Maps/Sets, for...in over object keys), spread (arrays/objects/strings/Maps/Sets), try/catch, ternary, the `in` operator, logical assignment (??=/||=/&&=), and bitwise operators (& | ^ ~ << >> >>>). Signal failure with `throw` (any value) or `throw new Error(message)`.",
    "Transform data with array methods (map/filter/reduce/reduceRight/flatMap/forEach/find/findIndex/findLast/findLastIndex/sort/toSorted/slice/concat/indexOf/at/flat/reverse/toReversed/with/includes/join, plus push/pop/shift/unshift for accumulation), string methods (toLowerCase/toUpperCase/trim/split/slice/substring/replace/replaceAll/includes/startsWith/endsWith/indexOf/padStart/padEnd/repeat/charCodeAt/match/matchAll/search), number methods (toFixed/toString(radix)/toPrecision), Object.keys/values/entries/fromEntries/hasOwn, Math.* (incl. PI/E), JSON.parse/stringify, Array.from/isArray/of, Number.isInteger/isNaN/parseInt, String.fromCharCode, parseInt/parseFloat, and Number/String/Boolean.",
    "Also available: Date (Date.now(), new Date(...), getTime/toISOString/getFullYear/..., date arithmetic and comparison), regular expressions (/literals/ and new RegExp(...), with test/exec and string match/matchAll/replace/replaceAll/split/search), and Map/Set (new Map()/new Set(), get/set/add/has/delete/size/forEach; keys/values/entries return arrays). Dates serialize to ISO strings at data boundaries; Map/Set/RegExp serialize to {} like JSON.stringify.",
  ]

  const toolSection: Array<string> = [""]
  if (empty) {
    toolSection.push("## Available tools", "", "No tools are currently available.")
  } else {
    toolSection.push(
      complete
        ? "## Available tools (COMPLETE list — every tool is shown below with its full call signature)"
        : `## Available tools (PARTIAL — ${totalShown} of ${described.length} shown; find the rest with tools.$codemode.search)`,
      "",
    )
    for (const [namespace, group] of ordered) {
      const picked = shown.get(namespace)!
      const count = `${group.length} tool${group.length === 1 ? "" : "s"}`
      // Annotate only when a namespace is not fully shown, so a comprehensive
      // namespace reads cleanly and a truncated one is unambiguous.
      const label = picked.size === group.length ? count : picked.size === 0 ? `${count}, none shown` : `${count}, ${picked.size} shown`
      toolSection.push(`- ${namespace} (${label})`)
      for (const tool of group) if (picked.has(tool)) toolSection.push(catalogLine(tool))
    }
    if (!complete) {
      toolSection.push(
        "",
        "Search returns complete callable signatures:",
        `- ${searchSignature}`,
      )
    }
  }

  const lines = [
    ...intro,
    ...workflow,
    ...rules,
    ...syntax,
    ...toolSection,
  ]
  return {
    catalog: described,
    instructions: lines.join("\n"),
    searchIndex: visible.map(({ path, definition, description }) => toSearchEntry(path, definition, description)),
  }
}

/**
 * The enumerable names at one node of the host tool tree — namespace names at the root,
 * tool/namespace names below — powering `Object.keys(tools)` and `for...in` over tool
 * references. A callable tool is a leaf and enumerates as `[]` (like `Object.keys` of a
 * function in JS). An unknown path is an `UnknownTool` error pointing at the working
 * discovery idioms, mirroring how calling an unknown tool fails.
 */
const namespaceKeys = <R>(tools: HostTools<R>, path: ReadonlyArray<string>, searchEnabled: boolean): ReadonlyArray<string> => {
  // The reserved discovery namespace is virtual (never present in the host tree); enumerate
  // it explicitly so `Object.keys(tools.$codemode)` matches the callable surface.
  if (searchEnabled && path.length === 1 && path[0] === reservedNamespace) return ["search"]
  let value: HostTool<R> | Definition<R> | HostTools<R> = tools
  for (const segment of path) {
    if (isBlockedMember(segment) || typeof value === "function" || isDefinition(value) || !Object.hasOwn(value, segment)) {
      throw new ToolRuntimeError(
        "UnknownTool",
        `Unknown tool namespace '${path.join(".")}'.`,
        searchEnabled
          ? ["Object.keys(tools) lists the available namespaces; tools.$codemode.search({ query }) finds described tools."]
          : ["Object.keys(tools) lists the available namespaces."],
      )
    }
    value = value[segment] as HostTool<R> | Definition<R> | HostTools<R>
  }
  if (typeof value === "function" || isDefinition(value)) return []
  return Object.keys(value)
}

const resolve = <R>(tools: HostTools<R>, path: ReadonlyArray<string>, searchEnabled: boolean): HostTool<R> | Definition<R> => {
  let value: HostTool<R> | Definition<R> | HostTools<R> = tools

  for (const segment of path) {
    if (isBlockedMember(segment) || typeof value === "function" || isDefinition(value) || !Object.hasOwn(value, segment)) {
      throw new ToolRuntimeError("UnknownTool", `Unknown tool '${path.join(".")}'.`, searchEnabled ? ["Use tools.$codemode.search({ query }) to find available described tools."] : [])
    }
    value = value[segment] as HostTool<R> | Definition<R> | HostTools<R>
  }

  if (typeof value !== "function" && !isDefinition(value)) {
    throw new ToolRuntimeError("UnknownTool", `Tool '${path.join(".")}' is not callable.`)
  }

  return value
}

export type ToolRuntime<R = never> = {
  readonly root: ToolReference
  readonly calls: Array<ToolCall>
  readonly invoke: (path: ReadonlyArray<string>, args: Array<unknown>) => Effect.Effect<unknown, unknown, R>
  /** Enumerable namespace/tool names at one node of the host tool tree; see `namespaceKeys`. */
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
}

export const dataByteLength = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value) ?? "").byteLength

const failureMessage = (error: unknown): string =>
  error instanceof ToolError || error instanceof ToolRuntimeError ? error.message : "Tool execution failed"

export const make = <R>(
  tools: HostTools<R>,
  maxToolCalls: number,
  dataLimits: DataLimits,
  hooks?: ToolCallHooks<R>,
  searchIndex?: ReadonlyArray<SearchEntry>,
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  let auditBytes = 0
  const searchEnabled = searchIndex !== undefined

  // Wraps the settling portion of a tool call so onToolCallEnd observes success and failure
  // symmetrically. Interruption (e.g. the execution timeout) fires neither outcome.
  const observeEnd = <A, E>(effect: Effect.Effect<A, E, R>, call: ToolCallStarted): Effect.Effect<A, E, R> => {
    const onEnd = hooks?.onToolCallEnd
    if (onEnd === undefined) return effect
    const startedAt = Date.now()
    return effect.pipe(
      Effect.tap(() => onEnd({ ...call, durationMs: Date.now() - startedAt, outcome: "success" })),
      Effect.tapError((error) =>
        onEnd({ ...call, durationMs: Date.now() - startedAt, outcome: "failure", message: failureMessage(error) })),
    )
  }

  const checkedCopyIn = (value: unknown, label: string): unknown => {
    const copied = copyIn(value, label, dataLimits)
    if (dataByteLength(copied) > dataLimits.maxDataBytes) {
      throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds ${dataLimits.maxDataBytes} bytes.`)
    }
    return copied
  }

  const decodeOutput = (value: unknown, name: string) =>
    Effect.try({
      try: () => checkedCopyIn(value, `Result from tool '${name}'`),
      catch: () => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}'.`),
    })

  const recordCall = (call: ToolCall): void => {
    if (calls.length >= maxToolCalls) {
      throw new ToolRuntimeError("ToolCallLimitExceeded", `Execution exceeded its tool-call limit of ${maxToolCalls}.`)
    }
    const auditEntryBytes = dataByteLength(call)
    if (auditBytes + auditEntryBytes > dataLimits.maxAuditBytes) {
      throw new ToolRuntimeError("AuditLimitExceeded", `Execution exceeds its audit-trail limit of ${dataLimits.maxAuditBytes} bytes.`)
    }
    auditBytes += auditEntryBytes
    calls.push(call)
  }

  return {
    root: new ToolReference([]),
    calls,
    keys: (path) => namespaceKeys(tools, path, searchEnabled),
    invoke: (path, args) =>
      Effect.gen(function*() {
        const name = path.join(".")
        const externalArgs = args.map((arg) => copyOut(copyIn(arg, `Arguments for tool '${name}'`, dataLimits)))
        const argumentBytes = dataByteLength(externalArgs)
        if (argumentBytes > dataLimits.maxDataBytes) {
          throw new ToolRuntimeError("InvalidDataValue", `Arguments for tool '${name}' exceed ${dataLimits.maxDataBytes} bytes.`)
        }
        const call = { name }
        const recordAndObserve = (input: unknown) =>
          Effect.sync(() => {
            recordCall(call)
            return calls.length - 1
          }).pipe(Effect.tap((index) => hooks?.onToolCallStart?.({ index, name, input }) ?? Effect.void))
        if (name === "$codemode.search") {
          if (!searchEnabled) throw new ToolRuntimeError("UnknownTool", `Unknown tool '${name}'.`)
          const input = externalArgs[0]
          if (externalArgs.length !== 1 || input === null || typeof input !== "object" || Array.isArray(input)) {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$codemode.search expects { query?: string; namespace?: string; limit?: number }.")
          }
          const request = input as { query?: unknown; namespace?: unknown; limit?: unknown }
          if (request.query !== undefined && typeof request.query !== "string") {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$codemode.search query must be a string when provided.")
          }
          if (request.namespace !== undefined && typeof request.namespace !== "string") {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$codemode.search namespace must be a string when provided.")
          }
          if (request.limit !== undefined && (typeof request.limit !== "number" || !Number.isSafeInteger(request.limit) || request.limit <= 0)) {
            throw new ToolRuntimeError("InvalidToolInput", "tools.$codemode.search limit must be a positive safe integer when provided.")
          }
          const query = typeof request.query === "string" ? request.query : ""
          const namespace = typeof request.namespace === "string" ? request.namespace : undefined
          const index = yield* recordAndObserve(request)
          return yield* observeEnd(
            Effect.try({
              try: () => {
                const limit = typeof request.limit === "number" ? request.limit : defaultSearchLimit
                const scoped = namespace === undefined ? searchIndex : searchIndex.filter((entry) => entry.namespace === namespace)
                // A query that names one tool path exactly (optionally `tools.`-prefixed) is a
                // lookup, not a search: return that tool alone.
                const trimmed = query.trim()
                const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice("tools.".length) : trimmed
                const exact = pathQuery === "" ? undefined : scoped.find((entry) => entry.description.path === pathQuery)
                const terms = tokenize(query)
                // Additive field-weighted scoring, summed across terms: exact path or path
                // segment (20) > path substring (8) > description substring (4) > any
                // searchable text, incl. input parameter names/descriptions (2). An empty
                // query browses everything, alphabetical by path.
                const ranked = exact !== undefined
                  ? [exact]
                  : scoped
                      .map((entry) => {
                        const path = entry.description.path.toLowerCase()
                        const description = entry.description.description.toLowerCase()
                        const score = terms.reduce(
                          (total, term) =>
                            total +
                            (path === term || path.endsWith(`.${term}`) ? 20 : 0) +
                            (path.includes(term) ? 8 : 0) +
                            (description.includes(term) ? 4 : 0) +
                            (entry.searchText.includes(term) ? 2 : 0),
                          0,
                        )
                        return { entry, score }
                      })
                      .filter(({ score }) => terms.length === 0 || score > 0)
                      .sort((left, right) =>
                        right.score - left.score || left.entry.description.path.localeCompare(right.entry.description.path))
                      .map(({ entry }) => entry)
                // Result paths carry the `tools.` prefix so each `path` is directly usable
                // as the call site (`await tools.github.list({ ... })`).
                const items = ranked.slice(0, limit).map(({ description }) => ({ ...description, path: `tools.${description.path}` }))
                return checkedCopyIn({ items, total: ranked.length }, "Result from tool '$codemode.search'")
              },
              catch: (cause) => cause,
            }),
            { index, name, input: request },
          )
        }

        const tool = resolve(tools, path, searchEnabled)
        let describedInput: unknown
        if (isDefinition(tool)) {
          if (externalArgs.length !== 1) throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects exactly one input object.`)
          describedInput = yield* Effect.try({
            try: () => decodeToolInput(tool, externalArgs[0]),
            catch: (cause) => new ToolRuntimeError("InvalidToolInput", `Invalid input for tool '${name}': ${String(cause)}`),
          })
        }
        const input = isDefinition(tool) ? describedInput : externalArgs
        const index = yield* recordAndObserve(input)
        const currentCall = { index, name, input }
        if (isDefinition(tool)) {
          return yield* observeEnd(
            Effect.gen(function*() {
              const raw = yield* runHost(Effect.suspend(() => tool.run(describedInput)))
              const result = yield* Effect.try({
                try: () => decodeToolOutput(tool, raw),
                catch: () => new ToolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}'.`),
              })
              return yield* decodeOutput(result, name)
            }),
            currentCall,
          )
        }
        return yield* observeEnd(
          Effect.gen(function*() {
            return yield* decodeOutput(yield* runHost(Effect.suspend(() => tool(...externalArgs))), name)
          }),
          currentCall,
        )
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
