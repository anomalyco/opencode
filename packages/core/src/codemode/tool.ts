export * as CodeModeTool from "./tool.js"

import { ToolFailure } from "@opencode/ai/effect"
import { CodeMode, Namespace, Tool } from "@opencode/codemode"
import type {
  Content,
  Context as ToolContext,
  Error,
  Info,
  Metadata,
  Namespace as ToolNamespace,
  Result,
} from "@opencode/schema/tool"
import { Identifier } from "@opencode/schema/identifier"
import { CallID } from "@opencode/schema/tool"
import { Clock, Context, Effect, Ref, Schema, Scope, Semaphore } from "effect"
import { toSessionError } from "../session/to-session-error.js"
import { definition, normalizedName } from "../tool/runtime.js"
import { FileAccess } from "../file-access.js"
import { FileMutation } from "../file-mutation.js"
import { FileWrite } from "../file-write.js"
import { Location } from "../location.js"
import { Permission } from "../permission.js"
import { PositiveInt } from "../schema.js"
import { CodeModeApi } from "./api.js"
import { CodeModeBun } from "./bun.js"
import { CodeModeCatalog } from "./catalog.js"
import { CodeModeDiffs } from "./diffs.js"
import { CodeModeExecution } from "./execution.js"
import { CodeModeFetch } from "./fetch.js"
import { CodeModePath } from "./path.js"

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

const TOOL_CALL_TRACE_LIMIT = 128

const ExecuteOutput = Schema.Struct({
  output: Schema.String,
  toolCalls: Schema.Array(ExecuteCall),
  toolCallsOmitted: Schema.optionalKey(Schema.Number),
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

// Per-execution parts of a runtime shared by every execution against the same inventory.
class Run extends Context.Service<
  Run,
  {
    readonly executeTool: (name: string, tool: Info, input: unknown) => Effect.Effect<unknown, unknown>
    readonly hooks: CodeMode.Hooks
  }
>()("@opencode/CodeModeTool/Run") {}

/** The session's Location and file services, which a run with the experimental `path` and `Bun` globals acts through. */
export type Services = Location.Service | CodeModeBun.Services

/** Those services alone, so a run they are given to keeps its own scope and the rest of its context. */
export const services = Effect.map(
  Effect.context<Services>(),
  Context.pick(Location.Service, FileAccess.Service, FileMutation.Service, FileWrite.Service),
)

/** What `opencode://` fetch acts through: this process's OpenCode API and the session's Location. */
export type Api = CodeModeApi.Service | Location.Service

export type Inventory = {
  readonly tools: ReadonlyMap<string, Info>
  readonly namespaces?: ReadonlyMap<string, ToolNamespace>
}

const extensions = [CodeModeFetch.extension, CodeModePath.extension, CodeModeBun.extension] as const
const fetchOnly = [CodeModeFetch.extension] as const
const runExtensions = (full: boolean) => (full ? extensions : fetchOnly)

const executionServices = (
  context: ToolContext,
  permission: Permission.Interface,
  services?: Context.Context<Services>,
  api?: Context.Context<Api>,
) =>
  Effect.map(Effect.abortSignal, (signal) =>
    Context.merge(services ?? Context.empty(), api ?? Context.empty()).pipe(
      Context.add(CodeModeExecution.Service, { ...context, signal }),
      Context.add(Permission.Service, permission),
    ),
  )

// Invariant model-facing guidance; the changing tool catalog is delivered through Instructions. With `full_codemode`,
// the runtime also has Bun's file APIs.
const description = (full: boolean) =>
  [
    full
      ? "Run JavaScript in a confined Code Mode runtime to work with files and data, script tool calls and HTTP requests, and compose their results."
      : "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
    "Write plain JavaScript and send it exactly as written: no code fence, and no JSON or other wrapper around it.",
    "Each call is a fresh program; nothing carries over from earlier calls.",
    full
      ? "`fetch` is available for HTTP requests, and Bun's file APIs (`Bun.file`, `Bun.write`, `Bun.Glob`) for files, in place of Node's `fs`. Imports and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`."
      : "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
    "Inside `execute`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
    'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
    "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
    "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
    ...(full
      ? [
          "Scripts still running after their timeout move to the background and keep running. Background scripts return a job ID immediately, and you will be notified when they complete; do not poll for them.",
        ]
      : []),
  ].join("\n")

// Mirrors the shell tool's `timeout` and `background`; only with `full_codemode`, where every script runs as a job.
export const FullInput = Schema.Struct({
  ...CodeMode.Input.fields,
  timeout: Schema.optionalKey(PositiveInt).annotate({
    description: `Optional time in milliseconds to wait for the script before moving it to the background (default ${2 * 60 * 1_000}). The script keeps running in the background after that; it is never stopped. With \`background: true\` the call returns immediately instead.`,
  }),
  background: Schema.optionalKey(Schema.Boolean).annotate({
    description:
      "Run the script in the background and return immediately with its job ID (useful for long-running work). You will be notified when it completes. DO NOT poll for completion.",
  }),
})

export const create = (
  inventory: Inventory,
  executeTool: (name: string, tool: Info, input: unknown, context: ToolContext) => Effect.Effect<Result, Error>,
  permission: Permission.Interface,
  /** With `full_codemode`, the session's services, which turn on the experimental `path` and `Bun` globals. */
  services?: Context.Context<Services>,
  /** What `opencode://` fetch sends requests through. Without it, `opencode://` fails as unavailable. */
  api?: Context.Context<Api>,
) => {
  return {
    name: "execute",
    description: description(services !== undefined),
    input: services ? FullInput : CodeMode.Input,
    freeform: { type: "text", field: "code" },
    output: ExecuteOutput,
    execute: ({ code }, context) =>
      Effect.gen(function* () {
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const trace = toolCallTrace()
        const lock = Semaphore.makeUnsafe(1)
        // Each update replaces the last, so send at most one per 100 ms; a trailing one carries the latest rows.
        // A success drops a pending one when the scope closes, since the result carries the final rows.
        const scope = yield* Effect.scope
        const publishedAt = yield* Ref.make(Number.NEGATIVE_INFINITY)
        const trailing = yield* Ref.make(false)
        const publish = Effect.gen(function* () {
          yield* Ref.set(trailing, false)
          yield* Ref.set(publishedAt, yield* Clock.currentTimeMillis)
          const changed = diffs.files()
          yield* context.progress({
            ...trace.metadata(),
            ...(changed.length > 0 ? { files: changed } : {}),
          })
        })
        const record = (update?: () => void) =>
          lock.withPermit(
            Effect.gen(function* () {
              update?.()
              if (yield* Ref.get(trailing)) return
              const wait = (yield* Ref.get(publishedAt)) + 100 - (yield* Clock.currentTimeMillis)
              if (wait <= 0) return yield* publish
              yield* Ref.set(trailing, true)
              yield* Effect.sleep(wait).pipe(Effect.andThen(lock.withPermit(publish)), Effect.forkIn(scope))
            }),
          )
        // The files the program changes, shown under the call as it runs and when it ends in the foreground. A failed
        // or stopped one keeps them too, since they really changed.
        const diffs = CodeModeDiffs.make(record())
        const result = yield* runtime(inventory)
          .execute(code, undefined, {
            extensions: runExtensions(services !== undefined),
          })
          .pipe(
            Effect.provideService(Run, {
              executeTool: (name, tool, input) =>
                Effect.gen(function* () {
                  const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
                  // Its own ID, so plugin hooks and traces can tell the program's calls apart. It has no row, so
                  // until the program ends its permission requests show on this call's.
                  const id = CallID.make(`call_${Identifier.ascending()}`)
                  yield* permission.nested(id, context.id).pipe(Scope.provide(scope))
                  // The program sees the same failure text the model gets for a direct call.
                  const call = executeTool(name, tool, input, {
                    ...context,
                    id,
                    codemode: true,
                    // Progress replaces the execute call's own, so an inner tool's updates would hide the call rows.
                    progress: () => Effect.void,
                    // A stop is the execute call's to handle: a nested call never fails it with its own error.
                    cancel: undefined,
                  }).pipe(
                    Effect.mapError((error) => new ToolFailure({ message: toSessionError(error).message, error })),
                  )
                  // The name the program called, so a namespaced tool that happens to be named edit or write records nothing.
                  const executed = yield* CodeModeDiffs.around(diffs, name, input, call)
                  const content = resultContent(executed)
                  const outputFileParts = outputFiles(content)
                  if (outputFileParts.length > 0)
                    yield* Ref.update(files, (items) => [...items, { index, files: outputFileParts }])
                  return resultValue(executed)
                }),
              hooks: progressHooks(trace, record),
            }),
            // A failed or interrupted call keeps its last progress, so send pending rows before it settles.
            Effect.onError(() =>
              lock.withPermit(Ref.get(trailing).pipe(Effect.flatMap((pending) => (pending ? publish : Effect.void)))),
            ),
            // Readers outlive the fetch call that returned them, up to the end of this program's scope.
            Effect.provide(yield* executionServices(context, permission, services, api)),
            Effect.provideService(CodeModeDiffs.Service, diffs),
          )
        const traceMetadata = trace.metadata()
        const collected = (yield* Ref.get(files))
          .toSorted((left, right) => left.index - right.index)
          .flatMap((item) => item.files)
        const output = formatResult(result)
        const value: typeof ExecuteOutput.Type = {
          output,
          ...traceMetadata,
          files: collected,
          ...(result.ok ? {} : { error: true }),
        }
        const content: Array<Content> = [
          { type: "text", text: value.output },
          ...value.files.map((file) => ({
            type: "file" as const,
            uri: `data:${file.mime};base64,${file.data}`,
            mime: file.mime,
            ...(file.name === undefined ? {} : { name: file.name }),
          })),
        ]
        const changed = diffs.files()
        const metadata: Metadata = {
          ...traceMetadata,
          ...(value.error ? { error: true } : {}),
          ...(changed.length > 0 ? { files: changed } : {}),
        }
        return {
          output: value,
          content,
          metadata,
        }
      }).pipe(Effect.scoped),
  } satisfies Info
}

// Bound finished rows without dropping calls that are still running.
function toolCallTrace() {
  const recent = new Map<object, ExecuteCall>()
  let finished = 0
  let total = 0
  let earlierError: ExecuteCall | undefined
  return {
    start(call: object, entry: ExecuteCall) {
      recent.set(call, entry)
      total++
    },
    settle(call: object, result: CodeMode.CallResult) {
      const entry = recent.get(call)
      if (entry?.status !== "running") return
      recent.set(call, { ...entry, status: result.status === "success" ? "completed" : "error" })
      finished++
      if (finished <= TOOL_CALL_TRACE_LIMIT) return

      for (const [key, row] of recent) {
        if (row.status === "running") continue
        if (row.status === "error") earlierError ??= row
        recent.delete(key)
        finished--
        break
      }
    },
    metadata() {
      const toolCalls = Array.from(recent.values())
      // Keep an earlier failure without displacing a row from the recent trace.
      if (earlierError) toolCalls.unshift(earlierError)
      const omitted = total - toolCalls.length
      return { toolCalls, ...(omitted > 0 ? { toolCallsOmitted: omitted } : {}) }
    },
  }
}

function progressHooks(
  trace: ReturnType<typeof toolCallTrace>,
  record: (update: () => void) => Effect.Effect<unknown>,
) {
  const start = (call: object, entry: ExecuteCall) => record(() => trace.start(call, entry))
  const settle = (call: object, result: CodeMode.CallResult) => record(() => trace.settle(call, result))
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
          if (call.extension === "bun")
            return start(call, { tool: "Bun", status: "running", input: CodeModeBun.display(call.name, call.args) })
          return Effect.void
      }
    },
    "extension.after": settle,
  } satisfies CodeMode.Hooks
}

const isPinned = (registration: Info) => {
  const codemode = registration.options?.codemode
  const pinned = typeof codemode === "object" && codemode !== null ? codemode.pinned : undefined
  return (pinned ?? registration.options?.pinned) === true
}

export const catalog = (inventory: Inventory) => {
  const pinned = new Set(Array.from(inventory.tools.values()).filter(isPinned).map(qualifiedName))
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
  const created = CodeMode.make({ tools: inventoryTools(inventory), extensions, hooks: runHooks })
  runtimes.set(inventory, created)
  return created
}

/**
 * Runs one program over `inventory` with no model step, binding `bindings` as outer globals.
 */
export const check = (
  inventory: Inventory,
  input: {
    readonly code: string
    readonly bindings: Readonly<Record<string, CodeMode.DataValue>>
    readonly limits: CodeMode.ExecutionLimits
    readonly context: ToolContext
    readonly permission: Permission.Interface
    readonly services?: Context.Context<Services>
  },
  executeTool: (name: string, tool: Info, input: unknown) => Effect.Effect<Result, Error>,
) =>
  CodeMode.make({
    tools: inventoryTools(inventory),
    extensions,
    hooks: runHooks,
    limits: input.limits,
  })
    .execute(input.code, input.bindings, { extensions: runExtensions(input.services !== undefined) })
    .pipe(
      Effect.provideService(Run, {
        executeTool: (name, tool, input) => executeTool(name, tool, input).pipe(Effect.map(resultValue)),
        hooks: {},
      }),
      (program) =>
        Effect.flatMap(executionServices(input.context, input.permission, input.services), (services) =>
          Effect.provide(program, services),
        ),
      Effect.scoped,
    )

function inventoryTools(inventory: Inventory) {
  // A path may carry namespace metadata, a callable tool, child tools, or all three.
  const root: ToolNode = { children: new Map() }
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const [name, registration] of inventory.tools) {
    const child = definition(registration, true)
    getNode(root, qualifiedName(registration)).tool = Tool.make({
      description: child.description,
      input: child.inputSchema,
      freeform: registration.freeform !== undefined,
      // JSON Schema, which Code Mode renders but does not check: Core has validated the result of the tool that ran,
      // and a plugin may have renamed the call to a tool with another output.
      output: child.outputSchema ?? { type: ["string", "null"] },
      execute: (input) => Run.use((run) => run.executeTool(name, registration, input)),
    })
  }
  return renderTools(root)
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

/** An inventory tool and its registry ID, by registry ID or by the path a program calls it at (`opencode.session.search`). */
export const find = (inventory: Inventory, name: string) => {
  const registration = inventory.tools.get(name)
  if (registration) return { id: name, registration }
  const entry = Array.from(inventory.tools).find(([, item]) => qualifiedName(item) === name)
  return entry && { id: entry[0], registration: entry[1] }
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
  // A program that only logs returns undefined (sent as null); a "null" line before its logs says nothing.
  const value = result.ok && result.value === null && (warnings || logs) ? undefined : output
  return [value, warnings, logs].filter((part) => part !== undefined && part !== "").join("\n\n")
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
