export * as CodeModeTool from "./tool.js"

import { ToolFailure } from "@opencode/ai/effect"
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
import { Clock, Context, Effect, Ref, Schema, Semaphore } from "effect"
import { isDeepStrictEqual } from "node:util"
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
    readonly executeTool: (name: string, tool: Info, input: unknown, key: string) => Effect.Effect<unknown, unknown>
    readonly before?: Before<string>
    readonly alias?: (key: string, note: string) => void
    readonly progress?: (
      call: CodeMode.ToolInvocation | CodeMode.ExtensionInvocation,
      status: ExecuteCall["status"],
    ) => Effect.Effect<void>
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
        const pendingNotes = new Map<string, string>()
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
              const previous = yield* Ref.get(calls)
              const next = update(previous)
              if (previous === next) return
              yield* Ref.set(calls, next)
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
              alias: (key, note) => pendingNotes.set(key, note),
              executeTool: (name, tool, input, key) =>
                Effect.gen(function* () {
                  // Resolution or validation can still reject a repair before the target runs.
                  const note = pendingNotes.get(key)
                  if (note !== undefined) {
                    pendingNotes.delete(key)
                    notes.add(note)
                  }
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
              progress: progressRows(record),
            }),
            // A failed or interrupted call keeps its last progress, so send pending rows before it settles.
            Effect.onError(() =>
              lock.withPermit(Ref.get(trailing).pipe(Effect.flatMap((pending) => (pending ? publish : Effect.void)))),
            ),
            Effect.provideService(CodeModeExecution.Service, context),
            Effect.provideService(Permission.Service, permission),
          )
        const toolCalls = yield* Ref.get(calls)
        const collected = (yield* Ref.get(files))
          .toSorted((left, right) => left.index - right.index)
          .flatMap((item) => item.files)
        const value: typeof ExecuteOutput.Type = {
          output: formatResult(result),
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

// The runtime carries one call object from admission to settlement, including across a repair.
function progressRows(record: (update: (items: Array<ExecuteCall>) => Array<ExecuteCall>) => Effect.Effect<void>) {
  const rows = new WeakMap<object, number>()
  return (call: CodeMode.ToolInvocation | CodeMode.ExtensionInvocation, status: ExecuteCall["status"]) => {
    if ("extension" in call && call.name !== "fetch") return Effect.void
    const input = "extension" in call ? CodeModeFetch.display(call.args) : displayInput(call.input)
    const entry = { tool: call.name, status, ...(input ? { input } : {}) }
    return record((items) => {
      const index = rows.get(call)
      if (index !== undefined) return isDeepStrictEqual(items[index], entry) ? items : items.with(index, entry)
      rows.set(call, items.length)
      // A before hook can edit the argument object in place. Keep the admitted row as it was published.
      return [...items, structuredClone(entry)]
    })
  }
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
      execute: (input, { key }) => Run.use((run) => run.executeTool(name, registration, input, key)),
    })
  }
  return { tools: renderTools(root), hooks: runHooks(paths, ids) }
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

function runHooks(paths: ReadonlyMap<string, Target>, ids: ReadonlyMap<string, Target>): CodeMode.Hooks<Run> {
  const running = (call: CodeMode.ToolInvocation | CodeMode.ExtensionInvocation) =>
    Run.use((run) => run.progress?.(call, "running") ?? Effect.void)
  const settled = (call: CodeMode.ToolInvocation | CodeMode.ExtensionInvocation, result: CodeMode.CallResult) =>
    Run.use((run) => run.progress?.(call, result.status === "success" ? "completed" : "error") ?? Effect.void)
  return {
    "tool.resolve": (call) =>
      Run.use((run) =>
        Effect.gen(function* () {
          if (run.progress) yield* run.progress(call, "running")
          const before = run.before
          if (!before) return call
          const original = paths.get(call.name)
          const requested = original?.definition.name ?? call.name
          const selected = yield* prepare(
            requested,
            call.input,
            (name) => {
              // The script must use a catalog path. Only a plugin redirect can select by registration ID.
              return name === requested ? original : (ids.get(name) ?? paths.get(name))
            },
            (name, input) => before(name, input, call.key),
          )
          if (!selected.target) {
            if (selected.name === requested) return { name: call.name, input: selected.input }
            return yield* new Error({ message: `Tool is not available for this request: ${selected.name}` })
          }
          const name = qualifiedName(selected.target.tool)
          if (original === undefined) run.alias?.(call.key, aliasNote(toolExpression(call.name), toolExpression(name)))
          return { name, input: selected.input }
        }),
      ),
    "tool.before": running,
    "tool.after": settled,
    "extension.before": running,
    "extension.after": settled,
  }
}

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
