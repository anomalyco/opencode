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
import {
  SandboxDate,
  SandboxMap,
  SandboxPromise,
  SandboxRegExp,
  SandboxSet,
  SandboxURL,
  SandboxURLSearchParams,
} from "./values.js"

const estimateTokens = (input: string) => Math.max(0, Math.round(input.length / 4))

export type HostTool<R = never> = (...args: Array<unknown>) => Effect.Effect<unknown, unknown, R>

export type HostTools<R = never> = {
  [name: string]: HostTool<R> | Definition<R> | HostTools<R>
}

export type Services<Tools> = ServicesOf<Tools, []>

type ServicesOf<Tools, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : Tools extends (...args: Array<unknown>) => Effect.Effect<unknown, unknown, infer R>
    ? R
    : Tools extends {
          readonly _tag: "CodeModeTool"
          readonly run: (input: unknown) => Effect.Effect<unknown, unknown, infer R>
        }
      ? R
      : Tools extends object
        ? string extends keyof Tools
          ? ServicesOf<Tools[string], [...Depth, unknown]>
          : ServicesOf<Tools[keyof Tools], [...Depth, unknown]>
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

/**
 * Maximum nesting depth for values crossing a data boundary. Fixed (not a configurable
 * limit) purely because it produces a clearer diagnostic than a native stack-overflow
 * RangeError would.
 */
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

/**
 * Validates and copies a value against the plain-data contract (depth, circularity, plain
 * objects only, blocked properties, data-only leaves).
 *
 * Two modes share the walk:
 * - **Boundary** (`preserveSandboxValues` false, the default): the host<->sandbox boundary -
 *   final results, tool-call arguments, `JSON.stringify`. Sandbox value types serialize
 *   exactly as JSON.stringify would: Date/URL -> strings, the remaining value types -> {}.
 * - **Intra-sandbox checkpoint** (`preserveSandboxValues` true; see `boundedData` in
 *   codemode.ts): standard-library value instances pass through untouched (treated as leaves,
 *   contents not walked), so values flowing through `Object.*` helpers, coercion inputs, and
 *   other in-sandbox checkpoints stay fully usable (`.getTime()`, `.has()`, ...).
 *
 * Both modes reject un-awaited promises with an await-hinting diagnostic.
 */
export const copyIn = (value: unknown, label: string, preserveSandboxValues = false): unknown =>
  copyBounded(value, label, 0, new Set(), preserveSandboxValues)

const copyBounded = (
  value: unknown,
  label: string,
  depth: number,
  seen: Set<object>,
  preserveSandboxValues: boolean,
): unknown => {
  if (depth > MAX_VALUE_DEPTH) {
    throw new ToolRuntimeError("InvalidDataValue", `${label} exceeds the maximum value depth of ${MAX_VALUE_DEPTH}.`)
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    // NaN/Infinity are allowed to exist as in-sandbox intermediates (matching real JS and a real
    // engine) so defensive guards like `Number.isNaN(x)` / `parseInt(x) || 0` can run. They are
    // normalized to `null` when the value leaves the sandbox - see copyOut - exactly as
    // JSON.stringify already does at any tool boundary.
    typeof value === "number"
  ) {
    return value
  }

  if (typeof value !== "object") {
    throw new ToolRuntimeError("InvalidDataValue", `${label} must contain data only.`)
  }

  // An un-awaited promise never crosses a data checkpoint as `{}`; the diagnostic tells the
  // model exactly how to fix the program instead.
  if (value instanceof SandboxPromise) {
    throw new ToolRuntimeError(
      "InvalidDataValue",
      `${label} contains an un-awaited Promise; await tool calls (e.g. \`const result = await tools.ns.tool(...)\`) before using their results.`,
    )
  }

  if (preserveSandboxValues) {
    // Intra-sandbox checkpoints keep sandbox value instances alive as leaves; their contents
    // are never walked here (Map/Set members are validated where mutation happens, and the
    // real boundary still serializes them below).
    if (
      value instanceof SandboxDate ||
      value instanceof SandboxRegExp ||
      value instanceof SandboxMap ||
      value instanceof SandboxSet ||
      value instanceof SandboxURL ||
      value instanceof SandboxURLSearchParams
    ) {
      return value
    }
    // Host instances cannot normally reach an intra-sandbox checkpoint (tool results cross
    // the boundary first), but wrap them defensively rather than degrading to JSON forms.
    if (value instanceof Date) return new SandboxDate(value.getTime())
    if (value instanceof RegExp) return new SandboxRegExp(value.source, value.flags)
    if (value instanceof Map) {
      const wrapped = new SandboxMap()
      for (const [key, item] of value.entries()) {
        wrapped.map.set(copyBounded(key, label, depth + 1, seen, true), copyBounded(item, label, depth + 1, seen, true))
      }
      return wrapped
    }
    if (value instanceof Set) {
      const wrapped = new SandboxSet()
      for (const item of value.values()) wrapped.set.add(copyBounded(item, label, depth + 1, seen, true))
      return wrapped
    }
    if (value instanceof URL) return new SandboxURL(new URL(value.href))
    if (value instanceof URLSearchParams) return new SandboxURLSearchParams(new URLSearchParams(value))
  }

  // Sandbox value types (and their host counterparts, which a host tool may legitimately
  // return) serialize exactly as JSON.stringify would at the data boundary: Date/URL use
  // toJSON(), while RegExp/Map/Set/URLSearchParams have no JSON form beyond {}.
  if (value instanceof SandboxDate) {
    return Number.isFinite(value.time) ? new Date(value.time).toISOString() : null
  }
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null
  }
  if (value instanceof SandboxURL) return value.url.href
  if (value instanceof URL) return value.href
  if (
    value instanceof SandboxRegExp ||
    value instanceof SandboxMap ||
    value instanceof SandboxSet ||
    value instanceof SandboxURLSearchParams ||
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
    const copied = value.map((item) => copyBounded(item, label, depth + 1, seen, preserveSandboxValues))
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
    copied[key] = copyBounded(item, label, depth + 1, seen, preserveSandboxValues)
  }
  seen.delete(value)
  return copied
}

export const copyOut = (value: unknown, undefinedAsNull = false): unknown => {
  if (value === undefined && undefinedAsNull) return null
  // Normalize non-finite numbers to null as the value crosses out of the sandbox (final return
  // and tool-call arguments both funnel through here), matching JSON semantics - NaN/Infinity
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

const definitions = <R>(
  tools: HostTools<R>,
  path: ReadonlyArray<string> = [],
): Array<{ path: string; definition: Definition<R> }> => {
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
  signature: `${toolExpression(path)}(input: ${inputTypeScript(definition, true)}): Promise<${outputTypeScript(definition, true)}>`,
})

const visibleDefinitions = <R>(tools: HostTools<R>) =>
  definitions(tools).map(({ path, definition }) => ({
    path,
    definition,
    description: describeDefinition(path, definition),
  }))

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

/**
 * A term plus its naive singular variants (trailing "s"/"es" stripped), so a plural
 * query term ("issues") still matches indexed text that only carries the singular
 * ("issue"). Matching is one-directional substring containment, so the variants are
 * needed only on the query side; scoring weights are unchanged - each field check
 * passes when ANY form matches.
 */
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
      // A query that names one tool path exactly (canonical path or rendered JavaScript
      // expression) is a lookup, not a search: return that tool alone.
      const trimmed = query.trim()
      const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice("tools.".length) : trimmed
      const exact =
        pathQuery === ""
          ? undefined
          : scoped.find(
              (entry) => entry.description.path === pathQuery || toolExpression(entry.description.path) === trimmed,
            )
      const terms = tokenize(query).map(termForms)
      // Additive field-weighted scoring, summed across terms: exact path or path segment
      // (20) > path substring (8) > description substring (4) > any searchable text,
      // including input parameter names and descriptions (2).
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

const searchDescription = describeDefinition(`${reservedNamespace}.search`, makeSearchTool([]))

const catalogLine = (tool: ToolDescription) => {
  // Keep the tool description concise; the full schema documentation remains in the signature.
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
 * signatures are inlined against the `catalogBudget` (estimated tokens,
 * chars/4) round-robin across namespaces - in each round (namespaces alphabetical), every
 * namespace still holding un-inlined tools attempts to place its next-cheapest line, and
 * a namespace whose next line does not fit is done while the others keep going - so every
 * namespace gets some representation before any namespace gets everything. The section
 * states exactly how comprehensive it is - overall (COMPLETE vs PARTIAL) and per
 * namespace. Namespace stub lines are never budgeted: every namespace appears with its
 * tool count even at budget 0.
 */
export const prepare = <R>(tools: HostTools<R>, catalogBudget = defaultCatalogBudget): DiscoveryPlan => {
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

  // Select which signatures fit the budget before emitting, so the list can state
  // exactly how comprehensive it is. Round-robin fairness: in each round (namespaces
  // alphabetical), every namespace still holding un-inlined tools tries to place its
  // next-cheapest line against the shared budget; a namespace whose next line does not
  // fit is done - the others keep going - so every namespace gets some representation
  // before any namespace gets everything.
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

  // Section order is deliberate: workflow first (the top is the least likely part of a long
  // description to be truncated or skimmed away), then rules, then syntax, with the budgeted
  // catalog at the bottom. Example call forms use placeholders - never a real or fabricated
  // tool name - and show both dot and bracket notation so non-identifier names are not normalized.
  const intro = [
    empty
      ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime."
      : complete
        ? "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the Code Mode tools listed below and internal runtime tools; surrounding agent tools are not available."
        : "This is a restricted JavaScript language for calling tools, not a general-purpose runtime. Inside the confined interpreter, `tools` contains the Code Mode tools listed or searchable below and internal runtime tools; surrounding agent tools are not available.",
    ...(empty
      ? []
      : ["Do not infer or normalize tool names; use only exact signatures shown below or returned by search."]),
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
              "1. Pick a tool from the list under `## Available tools` - each line is the exact call signature; use it as-is rather than guessing segments.",
              "2. Call it using the exact signature shown: `const result = await tools.<namespace>.<tool>(input)`; bracket notation and quotes are part of the path.",
              "3. Return only the fields you need from structured results; narrow unknown results before reading fields, and avoid returning large raw payloads.",
            ]
          : [
              '1. If needed, discover tools: `return await tools.$codemode.search({ query: "<intent + key nouns>" })`.',
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
          ? "- Only Code Mode tools listed here and internal runtime tools are available; surrounding agent tools are not implicitly exposed."
          : "- Only Code Mode tools listed here or returned by `tools.$codemode.search` and internal runtime tools are available; surrounding agent tools are not implicitly exposed.",
        "- Filter, aggregate, and transform collections in code - never return them raw or call a tool per item across messages.",
        "- A result typed `Promise<unknown>` may be structured data or text. Before reading fields, check that it is a non-null object and not an array; otherwise handle the returned text or primitive directly.",
        '- Run independent calls in parallel: `await Promise.all(items.map((item) => tools.<namespace>.<tool>(item)))`, or use `tools.<namespace>["tool-name"](item)` when the listed signature uses bracket notation.',
        "- `Object.keys(tools)` lists namespaces; `Object.keys(tools.<namespace>)` lists its tools; `for...in` works on both.",
        ...(complete
          ? []
          : [
              '- Browse one namespace: `await tools.$codemode.search({ query: "", namespace: "<name>" })`.',
              "- If search returns `next`, repeat the same search with `offset: next.offset`.",
            ]),
      ]

  const language = [
    "",
    "## Language",
    "",
    "Use common JavaScript data operations, functions, control flow, selected standard-library methods, and awaited tool calls. Built-ins include Date, RegExp, Map, Set, URL, URLSearchParams, and URI encoding helpers.",
    "Modules/imports, classes, generators, timers, fetch, eval, prototype access, unlisted methods, and promise chaining are unavailable. Use Code Mode tools for external operations. Use await with try/catch.",
    "Dates and URLs serialize to strings at data boundaries; Map/Set/RegExp/URLSearchParams serialize to `{}`.",
  ]

  const toolSection: Array<string> = [""]
  if (empty) {
    toolSection.push("## Available tools", "", "No tools are currently available.")
  } else {
    toolSection.push(
      complete
        ? "## Available tools (COMPLETE list - every tool is shown below with its full call signature)"
        : `## Available tools (PARTIAL - ${totalShown} of ${described.length} shown; find the rest with tools.$codemode.search)`,
      "",
    )
    for (const [namespace, group] of ordered) {
      const picked = shown.get(namespace)!
      const count = `${group.length} tool${group.length === 1 ? "" : "s"}`
      // Annotate only when a namespace is not fully shown, so a comprehensive
      // namespace reads cleanly and a truncated one is unambiguous.
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
      toolSection.push("", "Search returns complete callable signatures:", `- ${searchDescription.signature}`)
    }
  }

  const lines = [...intro, ...workflow, ...rules, ...language, ...toolSection]
  return {
    catalog: described,
    instructions: lines.join("\n"),
    searchIndex: visible.map(({ path, definition, description }) => toSearchEntry(path, definition, description)),
  }
}

/**
 * The enumerable names at one node of the callable tool tree - namespace names at the root,
 * tool/namespace names below - powering `Object.keys(tools)` and `for...in` over tool
 * references. A callable tool is a leaf and enumerates as `[]` (like `Object.keys` of a
 * function in JS). An unknown path is an `UnknownTool` error pointing at the working
 * discovery idioms, mirroring how calling an unknown tool fails.
 */
const namespaceKeys = <R>(tools: HostTools<R>, path: ReadonlyArray<string>): ReadonlyArray<string> => {
  let value: HostTool<R> | Definition<R> | HostTools<R> = tools
  for (const segment of path) {
    if (
      isBlockedMember(segment) ||
      typeof value === "function" ||
      isDefinition(value) ||
      !Object.hasOwn(value, segment)
    ) {
      throw new ToolRuntimeError("UnknownTool", `Unknown tool namespace '${path.join(".")}'.`, [
        "Object.keys(tools) lists the available namespaces; tools.$codemode.search({ query }) finds described tools.",
      ])
    }
    value = value[segment] as HostTool<R> | Definition<R> | HostTools<R>
  }
  if (typeof value === "function" || isDefinition(value)) return []
  return Object.keys(value)
}

const resolve = <R>(tools: HostTools<R>, path: ReadonlyArray<string>): HostTool<R> | Definition<R> => {
  let value: HostTool<R> | Definition<R> | HostTools<R> = tools

  for (const segment of path) {
    if (
      isBlockedMember(segment) ||
      typeof value === "function" ||
      isDefinition(value) ||
      !Object.hasOwn(value, segment)
    ) {
      throw new ToolRuntimeError("UnknownTool", `Unknown tool '${path.join(".")}'.`, [
        "Use tools.$codemode.search({ query }) to find available described tools.",
      ])
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
  /** Enumerable namespace/tool names at one node of the callable tool tree; see `namespaceKeys`. */
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
}

export const make = <R>(
  tools: HostTools<R>,
  /** Undefined means unlimited tool calls. */
  maxToolCalls: number | undefined,
  searchIndex: ReadonlyArray<SearchEntry>,
  hooks?: ToolCallHooks<R>,
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  const callableTools = {
    ...tools,
    [reservedNamespace]: { search: makeSearchTool(searchIndex) },
  }

  // Wraps the settling portion of a tool call so onToolCallEnd observes success and failure
  // symmetrically. Interruption (e.g. the execution timeout) fires neither outcome.
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

  return {
    root: new ToolReference([]),
    calls,
    keys: (path) => namespaceKeys(callableTools, path),
    invoke: (path, args) =>
      Effect.gen(function* () {
        const name = path.join(".")
        const externalArgs = args.map((arg) => copyOut(copyIn(arg, `Arguments for tool '${name}'`)))
        const call = { name }
        const recordAndObserve = (input: unknown) =>
          Effect.sync(() => {
            recordCall(call)
            return calls.length - 1
          }).pipe(Effect.tap((index) => hooks?.onToolCallStart?.({ index, name, input }) ?? Effect.void))
        const tool = resolve(callableTools, path)
        let describedInput: unknown
        if (isDefinition(tool)) {
          if (externalArgs.length !== 1)
            throw new ToolRuntimeError("InvalidToolInput", `Tool '${name}' expects exactly one input object.`)
          describedInput = yield* Effect.try({
            try: () => decodeToolInput(tool, externalArgs[0]),
            catch: (cause) =>
              new ToolRuntimeError("InvalidToolInput", `Invalid input for tool '${name}': ${String(cause)}`),
          })
        }
        const input = isDefinition(tool) ? describedInput : externalArgs
        const index = yield* recordAndObserve(input)
        const currentCall = { index, name, input }
        if (isDefinition(tool)) {
          return yield* observeEnd(
            Effect.gen(function* () {
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
          Effect.gen(function* () {
            return yield* decodeOutput(yield* runHost(Effect.suspend(() => tool(...externalArgs))), name)
          }),
          currentCall,
        )
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
