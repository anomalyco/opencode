import { Cause, Effect, Exit, Formatter, Schema } from "effect"
import type { DiagnosticKind } from "./codemode.js"
import { ToolError, toolError } from "./tool-error.js"
import { Host, HostFailure, type Json, type Run } from "psychoscript"
import {
  decodeInput as decodeToolInput,
  decodeOutput as decodeToolOutput,
  identifierSegment,
  inputProperties,
  inputTypeScript,
  isEmptyInput,
  outputTypeScript,
  stringParameter,
} from "./tool-schema.js"
import { isNamespace, type Namespace } from "./namespace.js"
import { type Durable, type ExecuteFn, isTool, type Tool, type ToolContext } from "./tool.js"
import type { Tools } from "./tools.js"

export type Services<T> = ServicesOf<T, []>

type ServicesOf<T, Depth extends ReadonlyArray<unknown>> = Depth["length"] extends 8
  ? never
  : T extends Tool<infer R>
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
  /** The call's idempotency key, `<runId>:<callId>`: the same at every hook, and across a suspended run's resumes. */
  readonly key: string
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

/** Runs `before`, then `run`, then `after` with how it ended, including when interrupted (unless `detaching`). */
export const hooked = <Call, A, R>(
  call: Call,
  before: ((call: Call) => Effect.Effect<void, unknown, R>) | undefined,
  after: ((call: Call, result: CallResult) => Effect.Effect<void, never, R>) | undefined,
  run: Effect.Effect<A, unknown, R>,
  detaching?: () => boolean,
): Effect.Effect<A, unknown, R> => {
  const observed =
    after === undefined
      ? run
      : Effect.onExit(run, (exit) => {
          if (detaching?.()) return Effect.void
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
        stringParameter(visible.tool)?.signature ??
          (isEmptyInput(visible.tool) ? "()" : `(${inputTypeScript(visible.tool, true)})`),
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
  /** Position in the full search index, for scoring through the word index. */
  readonly position: number
  /** The tool's searchable text by field, read when the word index is built. */
  readonly text: () => Readonly<Record<SearchField, ReadonlyArray<string>>>
  /** Words in the tool's own name (the last path segment). */
  readonly nameLength: number
}

type SearchField = "namespace" | "name" | "description" | "parameters" | "namespaceDescription"

// Standard field-weighted BM25 (k1 1.2, b 0.75) plus a preference for short names. Compared against other rankers on
// model-written and real search queries over an ~11k-tool catalog (anomalyco/evals, dumber/evals/tool-search).
const fieldWeights: Record<SearchField, number> = {
  name: 3,
  namespace: 2,
  description: 1,
  namespaceDescription: 0.4,
  parameters: 0.3,
}
const searchFields = Object.keys(fieldWeights) as ReadonlyArray<SearchField>
const k1 = 1.2
const lengthNormalization = 0.75
/** score × (1 + brevityBoost / words in the tool name): "users" prefers `list_users` over `list_user_groups`. */
const brevityBoost = 0.5
/** A query word of 4+ letters also matches longer words it starts with, at this weight: `term` → `terminal`. */
const prefixWeight = 0.3

/** Words split at case changes and non-alphanumerics: `listUserGroups` → list, user, groups. */
const splitWords = (text: string): Array<string> =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)

/** Plural endings only, applied the same everywhere: `settings` → `setting`, `statuses` → `status`, `vms` → `vm`. */
const stem = (word: string) => {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y"
  if (word.length > 4 && /(?:ss|sh|ch|x|z|us)es$/.test(word)) return word.slice(0, -2)
  if (word.length > 2 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1)
  return word
}

/** Searchable words of a text: its split words, plus each camelCase word whole (`CronJob` → cron, job, cronjob). */
const searchWords = (text: string) =>
  splitWords(text)
    .concat((text.match(/[A-Za-z0-9]*[a-z0-9][A-Z][A-Za-z0-9]*/g) ?? []).map((word) => word.toLowerCase()))
    .map(stem)

const fieldWords = (text: string, cache: Map<string, ReadonlyArray<string>>) => {
  const cached = cache.get(text)
  if (cached) return cached
  const words = searchWords(text)
  cache.set(text, words)
  return words
}

/** For each word, the tools containing it and their field-weighted, length-normalized term frequency. */
type WordIndex = {
  readonly postings: ReadonlyMap<string, { readonly positions: Int32Array; readonly weights: Float32Array }>
  readonly documents: number
  /** Sorted indexed words, for partial-word matching. */
  readonly words: ReadonlyArray<string>
}

// Built once per search index on the first query.
const wordIndexes = new WeakMap<ReadonlyArray<SearchEntry>, WordIndex>()

// Locations with the same tools (global MCP servers) share one word index, keyed by a hash of the indexed text. An
// index lives while some search index uses it; once none does it can be collected and its key is removed. A hash
// collision (about 1 in 37 trillion with 1,000 distinct catalogs alive) would only misrank results: they still come
// from the caller's own tools, and the tool count in the key keeps positions in range.
const shared =
  typeof WeakRef === "undefined" || typeof FinalizationRegistry === "undefined"
    ? undefined
    : {
        indexes: new Map<string, WeakRef<WordIndex>>(),
        cleanup: new FinalizationRegistry<{ key: string; ref: WeakRef<WordIndex> }>(({ key, ref }) => {
          // A newer index may have been stored under the same key since this one was dropped.
          if (shared?.indexes.get(key) === ref) shared.indexes.delete(key)
        }),
      }

const wordIndexFor = (index: ReadonlyArray<SearchEntry>): WordIndex => {
  const cached = wordIndexes.get(index)
  if (cached) return cached
  const texts = index.map((entry) => entry.text())
  const key = shared ? textKey(texts) : undefined
  const reused = key === undefined ? undefined : shared?.indexes.get(key)?.deref()
  if (reused) {
    wordIndexes.set(index, reused)
    return reused
  }
  const built = buildWordIndex(texts)
  wordIndexes.set(index, built)
  if (shared && key !== undefined) {
    const ref = new WeakRef(built)
    shared.indexes.set(key, ref)
    shared.cleanup.register(built, { key, ref })
  }
  return built
}

/** Tool count plus two independent 32-bit FNV-1a hashes of every indexed field, in index order. */
const textKey = (texts: ReadonlyArray<Readonly<Record<SearchField, ReadonlyArray<string>>>>) => {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  const add = (text: string) => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      first = Math.imul(first ^ code, 0x01000193)
      second = Math.imul(second ^ code, 0x5bd1e995)
      second ^= second >>> 15
    }
    // Separators keep field boundaries distinct: ["ab", "c"] and ["a", "bc"] hash differently.
    first = Math.imul(first ^ 0x1f, 0x01000193)
    second = Math.imul(second ^ 0x1f, 0x5bd1e995)
  }
  for (const text of texts)
    for (const field of searchFields) {
      for (const part of text[field]) add(part)
      add("\u0000")
    }
  return `${texts.length}:${(first >>> 0).toString(36)}:${(second >>> 0).toString(36)}`
}

const buildWordIndex = (texts: ReadonlyArray<Readonly<Record<SearchField, ReadonlyArray<string>>>>): WordIndex => {
  // Field texts are split once here and dropped afterwards; descriptions repeat across tools, so each text is split
  // once and shared while building.
  const cache = new Map<string, ReadonlyArray<string>>()
  const words = (texts: ReadonlyArray<string>) => texts.flatMap((text) => fieldWords(text, cache))
  const fields = texts.map((text) => {
    return {
      namespace: words(text.namespace),
      name: words(text.name),
      description: words(text.description),
      parameters: words(text.parameters),
      namespaceDescription: words(text.namespaceDescription),
    }
  })
  const averageLength = Object.fromEntries(
    searchFields.map((field) => [
      field,
      fields.reduce((sum, entry) => sum + entry[field].length, 0) / texts.length || 1,
    ]),
  ) as Record<SearchField, number>
  const building = new Map<string, { positions: Array<number>; weights: Array<number> }>()
  const weights = new Map<string, number>()
  fields.forEach((entry, position) => {
    weights.clear()
    for (const field of searchFields) {
      const weight =
        fieldWeights[field] /
        (1 - lengthNormalization + (lengthNormalization * entry[field].length) / averageLength[field])
      for (const word of entry[field]) weights.set(word, (weights.get(word) ?? 0) + weight)
    }
    for (const [word, weight] of weights) {
      let posting = building.get(word)
      if (!posting) building.set(word, (posting = { positions: [], weights: [] }))
      posting.positions.push(position)
      posting.weights.push(weight)
    }
  })
  const postings = new Map(
    [...building].map(([word, posting]) => [
      word,
      { positions: Int32Array.from(posting.positions), weights: Float32Array.from(posting.weights) },
    ]),
  )
  return { postings, documents: texts.length, words: [...postings.keys()].sort() }
}

/** Indexed words longer than a 4+ letter query word that start with it. */
const prefixMatches = (words: WordIndex, term: string): Array<readonly [string, number]> => {
  if (term.length < 4) return []
  let low = 0
  let high = words.words.length
  while (low < high) {
    const middle = (low + high) >> 1
    if (words.words[middle]! < term) low = middle + 1
    else high = middle
  }
  const matches: Array<readonly [string, number]> = []
  for (let i = low; i < words.words.length && words.words[i]!.startsWith(term); i++)
    if (words.words[i] !== term) matches.push([words.words[i]!, prefixWeight])
  return matches
}

const rank = (
  entries: ReadonlyArray<SearchEntry>,
  query: string,
  index: ReadonlyArray<SearchEntry>,
): Array<SearchEntry> => {
  const terms = searchWords(query)
  if (terms.length === 0)
    return [...entries].sort((left, right) => compareText(left.description.path, right.description.path))
  const words = wordIndexFor(index)
  const allowed = entries === index ? undefined : new Set(entries.map((entry) => entry.position))
  const scores = new Map<number, number>()
  for (const term of terms) {
    // Each tool counts a query word once, through its best-scoring match.
    const best = new Map<number, number>()
    for (const [word, factor] of [[term, 1] as const, ...prefixMatches(words, term)]) {
      const posting = words.postings.get(word)
      if (!posting) continue
      const idf = Math.log(1 + (words.documents - posting.positions.length + 0.5) / (posting.positions.length + 0.5))
      for (let i = 0; i < posting.positions.length; i++) {
        const position = posting.positions[i]!
        if (allowed && !allowed.has(position)) continue
        const weight = posting.weights[i]!
        const score = (factor * idf * weight * (k1 + 1)) / (weight + k1)
        if (score > (best.get(position) ?? 0)) best.set(position, score)
      }
    }
    for (const [position, score] of best) scores.set(position, (scores.get(position) ?? 0) + score)
  }
  return [...scores]
    .map(([position, score]) => ({
      entry: index[position]!,
      score: score * (1 + brevityBoost / Math.max(1, index[position]!.nameLength)),
    }))
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
      const ranked = exact !== undefined ? [exact] : rank(scoped, pathQuery, searchIndex)
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
  return `search(query: string | ${inputTypeScript(tool, true)}): ${outputTypeScript(tool, true)}`
})()

const toSearchEntry = <R>(visible: VisibleTool<R>, position: number): SearchEntry => {
  const segments = visible.path.split(".")
  const name = segments.at(-1) ?? ""
  return {
    description: describeTool(visible),
    position,
    text: () => ({
      namespace: segments.slice(0, -1),
      name: [name],
      description: [visible.tool.description],
      // Parameter names only: their descriptions are half of all words and didn't improve ranking.
      parameters: inputProperties(visible.tool).map((property) => property.name),
      namespaceDescription: visible.namespaces.map((namespace) => namespace.description ?? ""),
    }),
    nameLength: splitWords(name).length,
  }
}

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
    throw toolRuntimeError("UnknownTool", `Unknown tool namespace '${segments.join(".")}'.`)
  }
  return Array.from(node.children.keys())
}

// The tool at `path`, or why there is none.
const resolve = <R>(
  root: ToolNode<R>,
  path: ReadonlyArray<string>,
  index: ReadonlyArray<SearchEntry>,
): Tool<R> | HostFailure => {
  const segments = canonicalSegments(path)
  const node = lookup(root, segments)
  if (node === undefined) {
    const name = segments.join(".")
    const ns = segments.length > 1 && root.children.has(segments[0]) ? segments[0] : undefined
    const closest = rank(
      ns ? index.filter((entry) => entry.description.path.startsWith(`${ns}.`)) : index,
      ns ? segments.slice(1).join(" ") : name,
      index,
    )[0]
    return toolRuntimeError(
      "UnknownTool",
      closest
        ? `Unknown tool '${name}'. Did you mean ${toolExpression(closest.description.path)}?`
        : `Unknown tool '${name}'.`,
      ["Use search to find available tools."],
    )
  }
  if (node.tool === undefined) {
    const name = segments.join(".")
    const under = index.filter((entry) => entry.description.path.startsWith(`${name}.`))
    const ranked = rank(under, segments.at(-1) ?? "", index)
    const shown = [...ranked, ...under.filter((entry) => !ranked.includes(entry))]
      .slice(0, 3)
      .map((entry) => toolExpression(entry.description.path))
    const more = under.length - shown.length
    return toolRuntimeError(
      "UnknownTool",
      shown.length === 0
        ? `Tool '${name}' is not callable.`
        : `Tool '${name}' is not callable, it is a namespace. Did you mean ${new Intl.ListFormat("en", { type: "disjunction" }).format(shown)}?`,
      [
        more > 0
          ? `${more} more under '${name}'. Use search({ namespace: ${JSON.stringify(name)} }) to list them.`
          : "Use search to find available tools.",
      ],
    )
  }
  return node.tool
}

/** A tool-layer failure the program sees with its own diagnostic kind. */
const toolRuntimeError = (
  kind: Extract<DiagnosticKind, "UnknownTool" | "InvalidToolInput" | "InvalidToolOutput" | "ToolCallLimitExceeded">,
  message: string,
  suggestions: ReadonlyArray<string> = [],
) => new HostFailure(kind, message, suggestions)

// A ToolError (a tool's failure, or a hook's) is reported as `ToolFailure`.
const diagnosed = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  Effect.mapError(effect, (error) =>
    error instanceof ToolError ? new HostFailure("ToolFailure", error.message) : error,
  )

/** What a run keeps in `run.metadata`: its tool-call budget and the calls admitted so far, by key. */
type State = {
  readonly maxToolCalls: number | null
  readonly calls: Array<{ readonly name: string; readonly key: string }>
}

/** The tool calls a run admitted, from its `run.metadata`. */
export const toolCalls = (metadata: Json): Array<ToolCall> =>
  metadata === null ? [] : (metadata as unknown as State).calls.map((call) => ({ name: call.name }))

/**
 * The `tools` and `search` globals of one run, over tools prepared once for the runtime. The run's budget and its
 * admitted calls live in `run.metadata`, so a resumed run goes on counting where it was saved. Arguments arrive as
 * host values and are converted to JSON here; results leave as JSON.
 */
export const globals = <R>(
  prepared: Prepared<R>,
  hooks: Hooks<R>,
  run: Run,
  maxToolCalls: number | undefined,
): { readonly tools: Host.Namespace<R>; readonly search: Host.Fn<R> } => {
  const state = (run.metadata ??= { maxToolCalls: maxToolCalls ?? null, calls: [] }) as unknown as State
  // The input of each durable call started in this runtime, for `tool.after` once it ends.
  const invocations = new Map<string, ToolInvocation>()
  const root = prepared.root

  // Counts a call against `maxToolCalls`. An idempotent call run again on resume was counted when it first ran.
  const admit = (name: string, key: string, again: boolean): void => {
    if (again && state.calls.some((call) => call.key === key)) return
    if (state.maxToolCalls !== null && state.calls.length >= state.maxToolCalls) {
      throw toolRuntimeError(
        "ToolCallLimitExceeded",
        `Execution exceeded its tool-call limit of ${state.maxToolCalls}.`,
      )
    }
    state.calls.push({ name, key })
  }

  // A call's arguments as the tool's decoded input; throws the failure the call fails with.
  const decode = (name: string, tool: Tool<R>, args: ReadonlyArray<unknown>): unknown => {
    const json = args.map(toJson)
    const normalized = json.length === 0 ? [{}] : json
    if (normalized.length !== 1)
      throw toolRuntimeError("InvalidToolInput", `Tool '${name}' expects at most one input object.`)
    const input = normalized[0]
    const field = typeof input === "string" ? stringParameter(tool)?.name : undefined
    try {
      return decodeToolInput(tool, field === undefined ? input : { [field]: input })
    } catch (cause) {
      throw toolRuntimeError(
        "InvalidToolInput",
        `Invalid input for tool '${name}': ${String(cause)}`,
        name === "search"
          ? ['Pass search a query string or an object, such as search("issues") or search({ namespace: "github" }).']
          : ["The signature may have changed. Use search to get the current signature."],
      )
    }
  }

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
      catch: (cause) => toolRuntimeError("InvalidToolOutput", `Invalid output from tool '${name}': ${cause}`),
    })

  const executeTool = (
    name: string,
    tool: Tool<R>,
    run: ExecuteFn<unknown, unknown, R>,
    args: ReadonlyArray<unknown>,
    call: Host.Call,
    again: boolean,
  ) =>
    diagnosed(
      Effect.suspend(() => {
        const key = call.key
        let input: unknown
        try {
          input = decode(name, tool, args)
          admit(name, key, again)
        } catch (error) {
          return Effect.fail(error)
        }
        return hooked(
          { name, input, key },
          hooks["tool.before"],
          hooks["tool.after"],
          Effect.flatMap(failure(Effect.suspend(() => run(input, { key }))), (raw) => output(name, tool, raw)),
          call.suspending,
        )
      }),
    )

  const durableFn = (name: string, tool: Tool<R>, durable: Durable<unknown, unknown, R>) =>
    Host.durableFn<Json, R>({
      start: (args, call) =>
        diagnosed(
          Effect.gen(function* () {
            const key = call.key
            const input = yield* Effect.try({ try: () => decode(name, tool, args), catch: (error) => error })
            yield* Effect.try({ try: () => admit(name, key, false), catch: (error) => error })
            const invocation: ToolInvocation = { name, input, key }
            invocations.set(key, invocation)
            const before = hooks["tool.before"]
            const after = hooks["tool.after"]
            const started = failure(Effect.suspend(() => durable.start(input, { key }))).pipe(
              Effect.flatMap((raw) =>
                Effect.try({
                  try: (): Json => {
                    const text = JSON.stringify(raw)
                    return text === undefined ? null : JSON.parse(text)
                  },
                  catch: (cause) =>
                    toolRuntimeError("InvalidToolOutput", `Invalid start data from tool '${name}': ${cause}`),
                }),
              ),
            )
            const observed =
              after === undefined
                ? started
                : Effect.onError(started, (cause) => {
                    invocations.delete(key)
                    if (Cause.hasInterruptsOnly(cause)) return after(invocation, { status: "interrupted" })
                    return after(invocation, { status: "failure", error: Cause.squash(cause) })
                  })
            return yield* before === undefined ? observed : Effect.andThen(before(invocation), observed)
          }),
        ),
      wait: (data, call) => {
        const key = call.key
        const wait = durable.wait as (data: Json, context: ToolContext) => Effect.Effect<unknown, unknown, R>
        const after = hooks["tool.after"]
        const waited = Effect.gen(function* () {
          const raw = yield* failure(Effect.suspend(() => wait(data, { key })))
          return yield* output(name, tool, raw)
        })
        if (after === undefined) return diagnosed(waited)
        const known = invocations.get(key)
        const invocation =
          known !== undefined
            ? Effect.succeed(known)
            : Effect.try({
                try: (): ToolInvocation => ({ name, input: decode(name, tool, call.args), key }),
                catch: (error) => error,
              })
        return diagnosed(
          Effect.flatMap(invocation, (invocation) =>
            Effect.onExit(waited, (exit) => {
              if (call.suspending()) return Effect.void
              invocations.delete(key)
              if (Exit.isSuccess(exit)) return after(invocation, { status: "success", value: exit.value })
              if (Cause.hasInterruptsOnly(exit.cause)) return after(invocation, { status: "interrupted" })
              return after(invocation, { status: "failure", error: Cause.squash(exit.cause) })
            }),
          ),
        )
      },
      cancel: (data) => diagnosed(failure((durable.cancel as (data: Json) => Effect.Effect<void, unknown, R>)(data))),
    })

  // Each tool's host function, made once per run when it is first called.
  const functions = new Map<Tool<R>, Host.Fn<R> | Host.DurableFn<R>>()
  const toolFunction = (name: string, tool: Tool<R>): Host.Fn<R> | Host.DurableFn<R> => {
    const known = functions.get(tool)
    if (known !== undefined) return known
    const execute = tool.execute
    const made =
      "_tag" in execute && execute._tag === "CodeModeDurable"
        ? durableFn(name, tool, execute)
        : Host.fn(
            (args, call) =>
              executeTool(
                name,
                tool,
                "_tag" in execute ? execute.execute : execute,
                args,
                call,
                "_tag" in execute && execute._tag === "CodeModeIdempotent",
              ),
            { type: "async", idempotent: "_tag" in execute && execute._tag === "CodeModeIdempotent" },
          )
    functions.set(tool, made as Host.Fn<R> | Host.DurableFn<R>)
    return made as Host.Fn<R> | Host.DurableFn<R>
  }

  // `search("notes")` is shorthand for `search({ query: "notes" })`.
  const searchCall = (args: ReadonlyArray<unknown>, call: Host.Call) =>
    executeTool(
      "search",
      makeSearchTool(prepared.searchIndex),
      makeSearchTool(prepared.searchIndex).execute as ExecuteFn<unknown, unknown, R>,
      typeof args[0] === "string" ? [{ query: args[0] }, ...args.slice(1)] : args,
      call,
      false,
    )
  const search = Host.fn(searchCall, { type: "sync-thenable" })
  // Models often write `tools.search(...)` for the bare `search(...)`; it is honored unless a tool owns that path.
  const searchAlias = Host.fn(searchCall, { type: "async" })

  return {
    tools: Host.namespace<R>({
      keys: (path) => namespaceKeys(root, path),
      resolve: (path) => {
        const segments = canonicalSegments(path)
        if (segments.length === 1 && segments[0] === "search" && lookup(root, segments) === undefined) {
          return searchAlias as Host.Fn<R>
        }
        const found = resolve(root, path, prepared.searchIndex)
        // Tools are async, so a call to a missing one rejects its promise rather than throwing at the call.
        return found instanceof HostFailure
          ? Host.fn(() => Effect.fail(found), { type: "async" })
          : toolFunction(segments.join("."), found)
      },
    }),
    search: search as Host.Fn<R>,
  }
}

/**
 * A tool argument as JSON, as `JSON.stringify` would give it, with a few departures so a mistake is not a silent `{}`:
 * an Error gives its name, message, and own fields, a Set its items, a URLSearchParams its query string, and a
 * Uint8Array asks to be encoded as text first. A `__proto__` key is dropped.
 */
const toJson = (value: unknown): Json | undefined => {
  if (value === undefined || typeof value === "function") return undefined
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value !== "object") return undefined
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null
  if (value instanceof URL) return value.href
  if (value instanceof URLSearchParams) return value.toString()
  if (value instanceof Headers) return Object.fromEntries(value)
  if (value instanceof Uint8Array) {
    throw new HostFailure(
      "InvalidDataValue",
      "A Uint8Array cannot cross to a tool; pass text instead, e.g. `new TextDecoder().decode(bytes)` or `bytes.toBase64()`.",
    )
  }
  const items = Array.isArray(value) ? value : value instanceof Set ? [...value] : undefined
  if (items !== undefined) return Array.from(items, (item) => toJson(item) ?? null)
  const out: Record<string, Json> = {}
  const fields: Array<readonly [string, unknown]> =
    value instanceof Error
      ? [["name", value.name], ["message", value.message], ...Object.entries(value)]
      : value instanceof Map || value instanceof RegExp
        ? []
        : Object.entries(value)
  for (const [key, item] of fields) {
    if (key === "__proto__") continue
    const json = toJson(item)
    if (json !== undefined) out[key] = json
  }
  return out
}

export * as ToolRuntime from "./tool-runtime.js"

const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)
