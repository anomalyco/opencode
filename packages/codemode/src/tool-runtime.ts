import { Cause, Effect, Exit, Formatter, Schema } from "effect"
import type { Json } from "./vm/data.js"
import type { DiagnosticKind } from "./codemode.js"
import { toolError } from "./tool-error.js"
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
import { type Durable, type Idempotent, isTool, type Tool, type ToolContext } from "./tool.js"
import type { Tools } from "./tools.js"

export const compareText = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0)

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
  return `search(${inputTypeScript(tool, true)}): ${outputTypeScript(tool, true)}`
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
      index,
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

export type ExecuteCallOptions = {
  readonly key: string
  readonly admit: (name: string) => void
  readonly detaching?: (() => boolean) | undefined
}

/** The tool bridge of one execution. Arguments arrive and results leave as JSON; program values never enter. */
export type ToolRuntime<R = never> = {
  readonly calls: Array<ToolCall>
  readonly hooks: Hooks<R>
  readonly invocations: Map<string, ToolInvocation>
  readonly record: (name: string) => void
  readonly execute: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    options: ExecuteCallOptions,
  ) => Effect.Effect<Json | undefined, unknown, R>
  readonly search: (
    args: Array<Json | undefined>,
    options: ExecuteCallOptions,
  ) => Effect.Effect<Json | undefined, unknown, R>
  readonly keys: (path: ReadonlyArray<string>) => ReadonlyArray<string>
  /** How the tool at `path` executes on suspend (`undefined` when unknown or plain). */
  readonly mode: (
    path: ReadonlyArray<string>,
  ) => Idempotent<unknown, unknown, R> | Durable<unknown, unknown, R> | undefined
  /** Admits a call to a durable tool, runs `tool.before`, and starts its work under `key`: its JSON data. */
  readonly start: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    key: string,
    admit: (name: string) => void,
  ) => Effect.Effect<Json, unknown, R>
  /**
   * Waits for a durable tool's running work: its output, as `execute` gives it. `detaching` says whether an
   * interruption detaches to suspend the run, which `tool.after` doesn't see, or ends the call, which it sees as
   * interrupted.
   */
  readonly wait: (
    path: ReadonlyArray<string>,
    args: Array<Json | undefined>,
    key: string,
    data: Json,
    detaching: () => boolean,
  ) => Effect.Effect<Json | undefined, unknown, R>
  /** Cancels a durable tool's started work when the run is interrupted or ends. */
  readonly cancel: (path: ReadonlyArray<string>, data: Json) => Effect.Effect<void, unknown, R>
}

/** Per-execution call state over tools prepared once for the runtime. */
export const make = <R>(
  prepared: Prepared<R>,
  maxToolCalls: number | undefined,
  hooks: Hooks<R> = {},
): ToolRuntime<R> => {
  const calls: Array<ToolCall> = []
  const invocations = new Map<string, ToolInvocation>()
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
      const input = normalized[0]
      const field = typeof input === "string" ? stringParameter(tool)?.name : undefined
      return yield* Effect.try({
        try: () => decodeToolInput(tool, field === undefined ? input : { [field]: input }),
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

  const executeTool = (name: string, tool: Tool<R>, args: Array<Json | undefined>, options: ExecuteCallOptions) =>
    Effect.gen(function* () {
      if ("_tag" in tool.execute && tool.execute._tag === "CodeModeDurable") {
        throw new TypeError(`Tool '${name}' is a durable tool; start it with ToolRuntime.start.`)
      }
      const run = "_tag" in tool.execute ? tool.execute.execute : tool.execute
      const key = options.key
      const input = yield* decode(name, tool, args)
      yield* Effect.sync(() => options.admit(name))
      return yield* hooked(
        { name, input, key },
        hooks["tool.before"],
        hooks["tool.after"],
        Effect.gen(function* () {
          const raw = yield* failure(Effect.suspend(() => run(input, { key })))
          return yield* output(name, tool, raw)
        }),
        options.detaching,
      )
    })

  const durableTool = (
    path: ReadonlyArray<string>,
  ): {
    readonly name: string
    readonly tool: Tool<R>
    readonly durable: Durable<unknown, unknown, R>
  } => {
    const segments = canonicalSegments(path)
    const name = segments.join(".")
    const tool = lookup(root, segments)?.tool
    if (tool === undefined || !("_tag" in tool.execute) || tool.execute._tag !== "CodeModeDurable") {
      throw new TypeError(`Tool '${name}' is not a durable tool.`)
    }
    return { name, tool, durable: tool.execute }
  }

  return {
    calls,
    hooks,
    invocations,
    record: (name) => recordCall({ name }),
    keys: (path) => namespaceKeys(root, path),
    search: (args, options) =>
      Effect.suspend(() => executeTool("search", makeSearchTool(prepared.searchIndex), args, options)),
    execute: (path, args, options) =>
      Effect.suspend(() => {
        const segments = canonicalSegments(path)
        // Models often write `tools.search(...)` for the bare `search(...)`; honor it unless a tool owns that path.
        if (segments.length === 1 && segments[0] === "search" && lookup(root, segments) === undefined)
          return executeTool("search", makeSearchTool(prepared.searchIndex), args, options)
        return executeTool(segments.join("."), resolve(root, path, prepared.searchIndex), args, options)
      }),
    mode: (path) => {
      const segments = canonicalSegments(path)
      if (segments.length === 1 && segments[0] === "search" && lookup(root, segments) === undefined) return undefined
      const execute = lookup(root, segments)?.tool?.execute
      return execute !== undefined && "_tag" in execute ? execute : undefined
    },
    start: (path, args, key, admit) =>
      Effect.suspend(() => {
        const found = durableTool(path)
        return Effect.gen(function* () {
          const input = yield* decode(found.name, found.tool, args)
          yield* Effect.sync(() => admit(found.name))
          const invocation: ToolInvocation = { name: found.name, input, key }
          invocations.set(key, invocation)
          const before = hooks["tool.before"]
          const after = hooks["tool.after"]
          const run = failure(Effect.suspend(() => found.durable.start(input, { key }))).pipe(
            Effect.flatMap((raw) =>
              Effect.try({
                try: (): Json => {
                  const text = JSON.stringify(raw)
                  return text === undefined ? null : JSON.parse(text)
                },
                catch: (cause) =>
                  new ToolRuntimeError("InvalidToolOutput", `Invalid start data from tool '${found.name}': ${cause}`),
              }),
            ),
          )
          const observed =
            after === undefined
              ? run
              : Effect.onError(run, (cause) => {
                  invocations.delete(key)
                  if (Cause.hasInterruptsOnly(cause)) return after(invocation, { status: "interrupted" })
                  return after(invocation, { status: "failure", error: Cause.squash(cause) })
                })
          return yield* before === undefined ? observed : Effect.andThen(before(invocation), observed)
        })
      }),
    wait: (path, args, key, data, detaching) =>
      Effect.suspend(() => {
        const found = durableTool(path)
        const wait = found.durable.wait as (data: Json, context: ToolContext) => Effect.Effect<unknown, unknown, R>
        const after = hooks["tool.after"]
        const run = Effect.gen(function* () {
          const raw = yield* failure(Effect.suspend(() => wait(data, { key })))
          return yield* output(found.name, found.tool, raw)
        })
        if (after === undefined) return run
        const known = invocations.get(key)
        const callEffect =
          known !== undefined
            ? Effect.succeed(known)
            : Effect.map(
                decode(found.name, found.tool, args),
                (input): ToolInvocation => ({
                  name: found.name,
                  input,
                  key,
                }),
              )
        return Effect.flatMap(callEffect, (call) =>
          Effect.onExit(run, (exit) => {
            if (detaching()) return Effect.void
            invocations.delete(key)
            if (Exit.isSuccess(exit)) return after(call, { status: "success", value: exit.value })
            if (Cause.hasInterruptsOnly(exit.cause)) return after(call, { status: "interrupted" })
            return after(call, { status: "failure", error: Cause.squash(exit.cause) })
          }),
        )
      }),
    cancel: (path, data) =>
      Effect.suspend(() => {
        const cancel = durableTool(path).durable.cancel as (data: Json) => Effect.Effect<void, unknown, R>
        return failure(cancel(data))
      }),
  }
}

export * as ToolRuntime from "./tool-runtime.js"
