export * as CodeModeTool from "./tool.js"

import { ToolDefinition, ToolFailure } from "@opencode/ai/effect"
import { CodeMode, Namespace, Tool, toolExpression } from "@opencode/codemode"
import type {
  Content,
  Context as ToolContext,
  Info,
  Metadata,
  Namespace as ToolNamespace,
  Result,
} from "@opencode/schema/tool"
import { Error } from "@opencode/schema/tool"
import { isRecord } from "@opencode/util/record"
import { Clock, Context, Effect, Option, Ref, Schema, Semaphore } from "effect"
import { toSessionError } from "../session/to-session-error.js"
import { aliasNote, definition, normalizedName } from "../tool/runtime.js"
import { prepare, type Target } from "../tool/prepare.js"
import { Permission } from "../permission.js"
import { CodeModeCatalog } from "./catalog.js"
import { CodeModeExecution } from "./execution.js"
import { CodeModeFetch } from "./fetch.js"

const ExecuteFile = Schema.Struct({
  data: Schema.String,
  mime: Schema.String,
  name: Schema.optionalKey(Schema.String),
})

const ExecuteCall = Schema.Struct({
  tool: Schema.String,
  status: Schema.Literals(["running", "completed", "error"]),
  input: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
})

type ExecuteCall = typeof ExecuteCall.Type

const ExecuteOutput = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(ExecuteCall),
  error: Schema.optionalKey(Schema.Literal(true)),
  files: Schema.Array(ExecuteFile),
})

type CollectedFiles = {
  readonly index: number
  readonly files: Array<typeof ExecuteFile.Type>
}

type Node<T> = {
  tool?: T
  namespace?: ToolNamespace
  readonly children: Map<string, Node<T>>
}

type ToolNode = Node<Tool.Tool<Run>>

type Tools = {
  [name: string]: Tool.Tool<Run> | Namespace.Namespace<Run> | Tools
}

type Before<C> = (name: string, input: unknown, context: C) => Effect.Effect<{ tool: string; input: unknown }, Error>

// Per-execution parts of a runtime shared by every execution against the same inventory.
class Run extends Context.Service<
  Run,
  {
    readonly before?: Before<string>
    readonly executeTool: (
      name: string,
      tool: Info,
      input: unknown,
      key: string,
      note: string | undefined,
    ) => Effect.Effect<unknown, unknown>
    readonly hooks: CodeMode.Hooks
  }
>()("@opencode/CodeModeTool/Run") {}

export type Inventory = {
  readonly tools: ReadonlyMap<string, Info>
  readonly namespaces?: ReadonlyMap<string, ToolNamespace>
}

// Invariant model-facing guidance; the changing tool catalog is delivered through Instructions.
const description = [
  "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
  "Write plain JavaScript and send it exactly as written: no code fence, and no JSON or other wrapper around it.",
  "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
  "Inside `execute`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
  'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
  "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
  "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
].join("\n")

export const create = (
  inventory: Inventory,
  executeTool: (name: string, tool: Info, input: unknown, context: ToolContext) => Effect.Effect<Result, Error>,
  permission: Permission.Interface,
  before?: Before<ToolContext>,
) => {
  return {
    name: "execute",
    description,
    input: CodeMode.Input,
    freeform: { type: "text" },
    output: ExecuteOutput,
    execute: ({ code }, context) =>
      Effect.gen(function* () {
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const calls = yield* Ref.make<Array<ExecuteCall>>([])
        const notes = new Set<string>()
        const lock = Semaphore.makeUnsafe(1)
        // Each update replaces the last, so send at most one per 100 ms; a trailing one carries the latest rows.
        // A success drops a pending one when the scope closes, since the result carries the final rows.
        const scope = yield* Effect.scope
        const publishedAt = yield* Ref.make(Number.NEGATIVE_INFINITY)
        const trailing = yield* Ref.make(false)
        const publish = Effect.gen(function* () {
          yield* Ref.set(trailing, false)
          yield* Ref.set(publishedAt, yield* Clock.currentTimeMillis)
          yield* context.progress({ toolCalls: yield* Ref.get(calls) })
        })
        const record = (update: (items: Array<ExecuteCall>) => Array<ExecuteCall>) =>
          lock.withPermit(
            Effect.gen(function* () {
              yield* Ref.update(calls, update)
              if (yield* Ref.get(trailing)) return
              const wait = (yield* Ref.get(publishedAt)) + 100 - (yield* Clock.currentTimeMillis)
              if (wait <= 0) return yield* publish
              yield* Ref.set(trailing, true)
              yield* Effect.sleep(wait).pipe(Effect.andThen(lock.withPermit(publish)), Effect.forkIn(scope))
            }),
          )
        const result = yield* runtime(inventory)
          .execute(code)
          .pipe(
            Effect.provideService(Run, {
              before: before && ((name, input) => before(name, input, context)),
              executeTool: (name, tool, input, _key, note) =>
                Effect.gen(function* () {
                  if (note !== undefined) notes.add(note)
                  const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
                  // The program sees the same failure text the model gets for a direct call.
                  const executed = yield* executeTool(name, tool, input, {
                    ...context,
                    // Progress replaces the execute call's own, so an inner tool's updates would hide the call rows.
                    progress: () => Effect.void,
                    // A stop is the execute call's to handle: a nested call never fails it with its own error.
                    cancel: undefined,
                  }).pipe(
                    Effect.mapError((error) => new ToolFailure({ message: toSessionError(error).message, error })),
                  )
                  const content = resultContent(executed)
                  const outputFileParts = outputFiles(content)
                  if (outputFileParts.length > 0)
                    yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
                  return resultValue(executed)
                }),
              hooks: progressHooks(record),
            }),
            // A failed or interrupted call keeps its last progress, so send pending rows before it settles.
            Effect.onError(() =>
              lock.withPermit(Ref.get(trailing).pipe(Effect.flatMap((pending) => (pending ? publish : Effect.void)))),
            ),
            // Readers outlive the fetch call that returned them, up to the end of this program's scope.
            Effect.provideService(CodeModeExecution.Service, { ...context, signal: yield* Effect.abortSignal }),
            Effect.provideService(Permission.Service, permission),
          )
        const toolCalls = yield* Ref.get(calls)
        const collected = (yield* Ref.get(files))
          .toSorted((left, right) => left.index - right.index)
          .flatMap((item) => item.files)
        const output = formatResult(result)
        const value: typeof ExecuteOutput.Type = {
          output,
          toolCalls,
          files: collected,
          ...(result.ok ? {} : { error: true }),
        }
        const content: Array<Content> = [
          { type: "text", text: value.output },
          ...Array.from(notes, (text) => ({ type: "text" as const, text })),
          ...value.files.map((file) => ({
            type: "file" as const,
            uri: `data:${file.mime};base64,${file.data}`,
            mime: file.mime,
            ...(file.name === undefined ? {} : { name: file.name }),
          })),
        ]
        const metadata: Metadata = {
          toolCalls: value.toolCalls,
          ...(value.error ? { error: true } : {}),
        }
        return {
          output: value,
          content,
          metadata,
        }
      }).pipe(Effect.scoped),
  } satisfies Info
}

// Rows appear in start order; the same call object arrives at both hooks, so a call finds its row again.
function progressHooks(record: (update: (items: Array<ExecuteCall>) => Array<ExecuteCall>) => Effect.Effect<unknown>) {
  const rows = new WeakMap<object, number>()
  const start = (call: object, entry: ExecuteCall) =>
    record((items) => {
      rows.set(call, items.length)
      return [...items, entry]
    })
  const settle = (call: object, result: CodeMode.CallResult) => {
    const index = rows.get(call)
    if (index === undefined) return Effect.void
    return record((items) => {
      const next = [...items]
      next[index] = { ...items[index], status: result.status === "success" ? "completed" : "error" }
      return next
    })
  }
  return {
    "tool.before": (call) => {
      const shown = displayInput(call.input)
      return start(call, { tool: call.name, status: "running", ...(shown ? { input: shown } : {}) })
    },
    "tool.after": settle,
    // Only listed extension functions get a row; anything else stays out of the TUI.
    "extension.before": (call) => {
      switch (call.name) {
        case "fetch":
          return start(call, { tool: call.name, status: "running", input: CodeModeFetch.display(call.args) })
        default:
          return Effect.void
      }
    },
    "extension.after": settle,
  } satisfies CodeMode.Hooks
}

export const catalog = (inventory: Inventory) => {
  const pinned = new Set(
    Array.from(inventory.tools.values())
      .filter((registration) => registration.options?.pinned === true)
      .map(qualifiedName),
  )
  const root: CatalogNode = { children: new Map() }
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const tool of runtime(inventory).catalog)
    getNode(root, tool.path).tool = {
      type: "tool",
      name: tool.path.split(".").at(-1) ?? tool.path,
      description: tool.description,
      // Rendered only for the tools the catalog shows.
      get signature() {
        return tool.signature
      },
      pinned: pinned.has(tool.path),
    }
  return {
    tools: renderCatalog(root),
  } satisfies CodeModeCatalog.Inventory
}

type CatalogNode = Node<CodeModeCatalog.Tool>

function renderCatalog(root: CatalogNode): ReadonlyArray<CodeModeCatalog.Tool | CodeModeCatalog.Namespace> {
  return Array.from(root.children)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .flatMap(([name, node]) => {
      const tools = renderCatalog(node)
      const namespace =
        node.namespace === undefined && tools.length === 0
          ? undefined
          : {
              type: "namespace" as const,
              name,
              ...(node.namespace?.description === undefined ? {} : { description: node.namespace.description }),
              tools,
            }
      if (node.tool === undefined) return namespace === undefined ? [] : [namespace]
      if (namespace === undefined) return [node.tool]
      return [node.tool, namespace]
    })
}

// Inventories are immutable snapshots, so tool definitions, schemas, and the search index are built
// once per inventory and shared by its catalog and every execution.
const runtimes = new WeakMap<Inventory, CodeMode.Runtime<Run | CodeModeExecution.Service | Permission.Service>>()

function runtime(inventory: Inventory) {
  const cached = runtimes.get(inventory)
  if (cached) return cached
  const entries = inventoryTools(inventory)
  const created = CodeMode.make<typeof entries.tools, [typeof CodeModeFetch.extension]>({
    ...entries,
    extensions: [CodeModeFetch.extension],
  })
  runtimes.set(inventory, created)
  return created
}

/**
 * Runs one program over `inventory` alone with no model step and no `fetch`, binding `bindings` as outer globals.
 */
export const check = (
  inventory: Inventory,
  code: string,
  bindings: Readonly<Record<string, CodeMode.DataValue>>,
  limits: CodeMode.ExecutionLimits,
  executeTool: (name: string, tool: Info, input: unknown, key: string) => Effect.Effect<Result, Error>,
  before?: Before<string>,
) =>
  CodeMode.make({
    ...inventoryTools(inventory),
    limits,
  })
    .execute(code, bindings)
    .pipe(
      Effect.provideService(Run, {
        before,
        executeTool: (name, tool, input, key) => executeTool(name, tool, input, key).pipe(Effect.map(resultValue)),
        hooks: {},
      }),
    )

function inventoryTools(inventory: Inventory) {
  // A path may carry namespace metadata, a callable tool, child tools, or all three.
  const root: ToolNode = { children: new Map() }
  const paths = new Map<string, Target>()
  const ids = new Map<string, Target>()
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const [name, registration] of inventory.tools) {
    const child = definition(registration)
    const path = qualifiedName(registration)
    const target = { tool: registration, definition: child }
    paths.set(path, target)
    ids.set(name, target)
    getNode(root, path).tool = Tool.make({
      description: child.description,
      input: child.inputSchema,
      freeform: registration.freeform !== undefined,
      output: child.outputSchema ?? Schema.NullOr(Schema.String),
      // A registered path always selects a tool or fails, so it is never left unclaimed.
      execute: (input, { key }) => call(path, input, key).pipe(Effect.map(Option.getOrThrow)),
    })
  }

  // A nested call runs the way a direct call does: plugins may repair and redirect it, then the selected tool runs.
  const call = (path: string, input: unknown, key: string) =>
    Run.use((run) =>
      Effect.gen(function* () {
        const original = paths.get(path)
        const requested = original?.definition.name ?? path
        const selected = yield* prepare(
          requested,
          freeformText(original, input),
          // The script must use a catalog path. Only a plugin redirect can select by registration ID.
          (name) => (name === requested ? original : (ids.get(name) ?? paths.get(name))),
          (name, input) => (run.before ? run.before(name, input, key) : Effect.succeed({ tool: name, input })),
        )
        if (!selected.target) {
          // Left unknown: Code Mode reports it with its own suggestions.
          if (selected.name === requested) return Option.none()
          return yield* new Error({ message: `Tool is not available for this request: ${selected.name}` })
        }
        const note =
          original === undefined
            ? aliasNote(toolExpression(path), toolExpression(qualifiedName(selected.target.tool)))
            : undefined
        return Option.some(
          yield* run.executeTool(selected.target.definition.name, selected.target.tool, selected.input, key, note),
        )
      }),
    )

  const hooks = {
    ...runHooks,
    "tool.missing": (invocation) => call(invocation.name, invocation.input, invocation.key),
  } satisfies CodeMode.Hooks<Run>
  return { tools: renderTools(root), hooks }
}

// Code Mode hands `tools.draft("text")` to a freeform tool as `{ body: "text" }`. Repair starts from the text, as a
// direct call's does, so a redirect to another freeform tool can put it under that tool's own field.
function freeformText(target: Target | undefined, input: unknown) {
  const field = target?.definition.freeform ? ToolDefinition.freeformField(target.definition.inputSchema) : undefined
  if (field === undefined || !isRecord(input) || Object.keys(input).length !== 1) return input
  return typeof input[field] === "string" ? input[field] : input
}

function resultContent(executed: Result) {
  return typeof executed.content === "string"
    ? [{ type: "text" as const, text: executed.content }]
    : (executed.content ?? [])
}

function resultValue(executed: Result) {
  if (executed.output !== undefined) return executed.output
  const text = resultContent(executed)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
    .join("\n")
  return text === "" ? null : text
}

const runHooks = {
  "tool.before": (call) => Run.use((run) => run.hooks["tool.before"]?.(call) ?? Effect.void),
  "tool.after": (call, result) => Run.use((run) => run.hooks["tool.after"]?.(call, result) ?? Effect.void),
  "extension.before": (call) => Run.use((run) => run.hooks["extension.before"]?.(call) ?? Effect.void),
  "extension.after": (call, result) => Run.use((run) => run.hooks["extension.after"]?.(call, result) ?? Effect.void),
} satisfies CodeMode.Hooks<Run>

function getNode<T>(root: Node<T>, path: string) {
  return path.split(".").reduce((parent, name) => {
    const child: Node<T> = parent.children.get(name) ?? { children: new Map() }
    parent.children.set(name, child)
    return child
  }, root)
}

function renderTools(root: ToolNode) {
  const callables = new Map<string, Tool.Tool<Run>>()
  const tools = renderChildren(root, [], callables)
  for (const [path, tool] of callables) tools[path] = tool
  return tools
}

function renderChildren(node: ToolNode, path: ReadonlyArray<string>, callables: Map<string, Tool.Tool<Run>>): Tools {
  return Object.fromEntries(
    Array.from(node.children).flatMap(([name, child]) => {
      const next = [...path, name]
      // A record cannot hold both a top-level tool and namespace under the same key.
      if (path.length === 0 && child.tool !== undefined && (child.namespace !== undefined || child.children.size > 0)) {
        const tools: Tools = {}
        flattenTools(child, next, tools)
        return Object.entries(tools)
      }
      return [[name, renderEntry(child, next, callables)]]
    }),
  )
}

function renderEntry(
  node: ToolNode,
  path: ReadonlyArray<string>,
  callables: Map<string, Tool.Tool<Run>>,
): Tools[string] {
  const tools = renderChildren(node, path, callables)
  // CodeMode merges this dotted tool path with the nested namespace entry.
  if (node.tool !== undefined && (node.namespace !== undefined || node.children.size > 0))
    callables.set(path.join("."), node.tool)
  if (node.namespace !== undefined)
    return Namespace.make({
      description: node.namespace.description,
      tools,
    })
  if (node.tool === undefined) return tools
  if (node.children.size === 0) return node.tool
  return tools
}

function flattenTools(node: ToolNode, path: ReadonlyArray<string>, tools: Tools) {
  if (node.tool !== undefined) tools[path.join(".")] = node.tool
  for (const [name, child] of node.children) flattenTools(child, [...path, name], tools)
}

export function qualifiedName(registration: Info) {
  const normalized = normalizedName(registration)
  if (registration.options?.namespace === undefined) return normalized
  return `${registration.options.namespace}.${normalized}`
}

// Tool inputs arrive as parsed JSON, so the JSON value cast is a boundary fact.
function displayInput(input: unknown): Record<string, typeof Schema.Json.Type> | undefined {
  if (input === null || input === undefined) return
  if (typeof input !== "object" || Array.isArray(input)) return { input: input as typeof Schema.Json.Type }
  if (Object.keys(input).length === 0) return
  return input as Record<string, typeof Schema.Json.Type>
}

function formatResult(result: CodeMode.Result) {
  const output = result.ok
    ? formatValue(result.value)
    : [result.error.message, ...(result.error.suggestions ?? []).filter((hint) => !result.error.message.includes(hint))]
        .join("\n")
        .trim()
  const warnings =
    result.ok && result.warnings && result.warnings.length > 0
      ? `Warnings:\n${result.warnings.map((item) => `- [${item.kind}] ${item.message}`).join("\n")}`
      : undefined
  const logs = result.logs && result.logs.length > 0 ? `Logs:\n${result.logs.join("\n")}` : undefined
  return [output, warnings, logs].filter((part) => part !== undefined && part !== "").join("\n\n")
}

// Compact JSON: indentation adds tokens on every later step without helping the model. Clients pretty-print it.
function formatValue(value: CodeMode.DataValue) {
  if (typeof value === "string") return value
  return JSON.stringify(value) ?? String(value)
}

function outputFiles(content: ReadonlyArray<Content>): Array<typeof ExecuteFile.Type> {
  return content.flatMap((part) => {
    if (part.type !== "file") return []
    const prefix = `data:${part.mime};base64,`
    if (!part.uri.startsWith(prefix)) return []
    return [
      {
        data: part.uri.slice(prefix.length),
        mime: part.mime,
        ...(part.name === undefined ? {} : { name: part.name }),
      },
    ]
  })
}
