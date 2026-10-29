export * as CodeModeTool from "./tool.js"

import { CodeMode, Namespace, Tool } from "@opencode/codemode"
import { Identifier } from "@opencode/schema/identifier"
import { NonNegativeInt } from "@opencode/schema/schema"
import type {
  Content,
  Context as ToolContext,
  Error,
  Info,
  Metadata,
  Namespace as ToolNamespace,
  Result,
} from "@opencode/schema/tool"
import { Clock, Context, Effect, Option, Ref, Schema, Semaphore } from "effect"
import { Job } from "../job.js"
import { Session } from "../session.js"
import { definition, normalizedName } from "../tool/runtime.js"
import { CodeModeCatalog } from "./catalog.js"
import { CodeModeWeb } from "./web.js"

export type Host = {
  readonly jobs: Job.Interface
  readonly sessions: Pick<Session.Interface, "synthetic">
}

const hosts = new WeakMap<object, Host>()

export function bind(owner: object, host: Host) {
  hosts.set(owner, host)
}

export function hostFor(owner: object): Host | undefined {
  return hosts.get(owner)
}

const BACKGROUND_INSTRUCTION =
  "You will be notified automatically when execution finishes. DO NOT sleep or poll in loops; continue with independent work or end your response and wait to be resumed, or call tools.opencode.job_wait / tools.opencode.job_output / tools.opencode.job_stop with this jobID."

export const ExecuteInput = Schema.Struct({
  ...CodeMode.Input.fields,
  yield_after: Schema.optionalKey(NonNegativeInt).annotate({
    description: `Milliseconds to wait before moving execution to the background and returning output so far. Defaults to ${Job.DEFAULT_YIELD_AFTER_MS}. Set to 0 to run in the background immediately.`,
  }),
})

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
  status: Schema.optionalKey(Schema.Literals(["completed", "running"])),
  jobID: Schema.optionalKey(Schema.String),
})

type ExecuteOutput = typeof ExecuteOutput.Type

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

export type Inventory = {
  readonly tools: ReadonlyMap<string, Info>
  readonly namespaces?: ReadonlyMap<string, ToolNamespace>
}

// Invariant model-facing guidance; the changing tool catalog is delivered through Instructions.
const description = [
  "Run JavaScript in a confined Code Mode runtime to script tool calls and HTTP requests and compose their results.",
  "`fetch` is available for HTTP requests. Imports, direct filesystem access, and timers are unavailable: there is no `setTimeout` or sleep. All other external access goes through `tools`.",
  "Within `{ code }`, the only callable tools are those explicitly listed in the Code Mode catalog instructions or returned by the `search` function. Inside `{ code }`, ignore tools shown outside the Code Mode catalog. They are not available in the Code Mode runtime.",
  'Call tools through `tools` using only exact paths and signatures from the catalog. Do not infer or normalize tool names; preserve bracket notation such as `tools.<namespace>["tool-name"](input)`.',
  "Prefer an explicit `return`; if omitted, the final top-level expression becomes the result.",
  "Await every call whose completion matters; pending calls are interrupted when execution ends. Run independent calls concurrently with `Promise.allSettled`.",
].join("\n")

export function noticeText(input: { id: string; state: string; body: string }) {
  return `<execute id="${input.id}" state="${input.state}">\n${input.body}\n</execute>`
}

export const create = (
  inventory: Inventory,
  executeTool: (name: string, tool: Info, input: unknown, context: ToolContext) => Effect.Effect<Result, Error>,
  boundHost?: Host,
) => {
  return {
    name: "execute",
    description,
    input: ExecuteInput,
    output: ExecuteOutput,
    execute: (input, context) =>
      Effect.gen(function* () {
        const code: string = input.code
        const logs: Array<string> = []
        const callIndex = yield* Ref.make(0)
        const files = yield* Ref.make<Array<CollectedFiles>>([])
        const calls = yield* Ref.make<Array<ExecuteCall>>([])
        const waitingJobs = yield* Ref.make(0)
        const yielded = yield* Ref.make(false)

        const runOnce = Effect.gen(function* () {
          const lock = Semaphore.makeUnsafe(1)
          // Each update replaces the last, so send at most one per 100 ms; a trailing one carries the latest rows.
          // A success drops a pending one when the scope closes, since the result carries the final rows.
          const scope = yield* Effect.scope
          const publishedAt = yield* Ref.make(Number.NEGATIVE_INFINITY)
          const trailing = yield* Ref.make(false)
          const publish = Effect.gen(function* () {
            yield* Ref.set(trailing, false)
            yield* Ref.set(publishedAt, yield* Clock.currentTimeMillis)
            if (yield* Ref.get(yielded)) return
            yield* context.progress({ toolCalls: yield* Ref.get(calls) })
          })
          const record = (update: (items: Array<ExecuteCall>) => Array<ExecuteCall>) =>
            lock.withPermit(
              Effect.gen(function* () {
                yield* Ref.update(calls, update)
                if ((yield* Ref.get(trailing)) || (yield* Ref.get(yielded))) return
                const wait = (yield* Ref.get(publishedAt)) + 100 - (yield* Clock.currentTimeMillis)
                if (wait <= 0) return yield* publish
                yield* Ref.set(trailing, true)
                yield* Effect.sleep(wait).pipe(Effect.andThen(lock.withPermit(publish)), Effect.forkIn(scope))
              }),
            )
          const result = yield* runtime(inventory)
            .execute(code, undefined, { logs })
            .pipe(
              Effect.provideService(Run, {
                executeTool: (name, tool, toolInput) =>
                  Effect.gen(function* () {
                    const index = yield* Ref.getAndUpdate(callIndex, (index) => index + 1)
                    const isJobWait = name === "opencode_job_wait"
                    if (isJobWait) yield* Ref.update(waitingJobs, (n) => n + 1)
                    const executed = yield* executeTool(name, tool, toolInput, context).pipe(
                      Effect.ensuring(isJobWait ? Ref.update(waitingJobs, (n) => Math.max(0, n - 1)) : Effect.void),
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
            )
          const toolCalls = yield* Ref.get(calls)
          const collected = (yield* Ref.get(files))
            .toSorted((left, right) => left.index - right.index)
            .flatMap((item) => item.files)
          const output = formatResult(result)
          const value: ExecuteOutput = {
            output,
            toolCalls,
            files: collected,
            ...(result.ok ? {} : { error: true }),
          }
          return { output: value.output, value }
        }).pipe(Effect.scoped)

        const ambientJobs = Option.getOrUndefined(yield* Effect.serviceOption(Job.Service))
        const ambientSessions = Option.getOrUndefined(yield* Effect.serviceOption(Session.Service))
        const resolvedHost =
          boundHost ?? (ambientJobs && ambientSessions ? { jobs: ambientJobs, sessions: ambientSessions } : undefined)

        if (!resolvedHost) {
          const completed = yield* runOnce
          return completedResult(completed.value)
        }

        const readPartial = Ref.get(calls).pipe(
          Effect.map((toolCalls) => formatPartial(logs, toolCalls)),
        )
        const id = `job_${Identifier.create(false)}`
        const title = code
          .split("\n")
          .map((line) => line.trim())
          .find((line) => line.length > 0)
          ?.slice(0, 80)

        yield* resolvedHost.jobs.start<ExecuteOutput>({
          id,
          sessionID: context.sessionID,
          type: "execute",
          title: title ?? "execute",
          metadata: { sessionID: context.sessionID },
          recovery: { kind: "execute", sessionID: context.sessionID, code },
          run: runOnce,
          output: readPartial,
          onSettle: (settled) => {
            if (settled.status === "running") return Effect.void
            const body =
              settled.status === "completed"
                ? (settled.output ?? "")
                : settled.status === "error"
                  ? (settled.error ?? "Code Mode execution failed")
                  : settled.output
                    ? `${settled.output}\n\nCancelled`
                    : "Cancelled"
            return resolvedHost.sessions
              .synthetic({
                ...(settled.notificationID ? { id: settled.notificationID } : {}),
                sessionID: context.sessionID,
                description: "Code Mode",
                ...(settled.status === "cancelled" ? { resume: false } : {}),
                text: noticeText({ id, state: settled.status, body }),
                metadata: { source: "execute", jobID: id, state: settled.status },
              })
              .pipe(Effect.ignore)
          },
        })

        if (input.yield_after === 0) {
          yield* Ref.set(yielded, true)
          yield* resolvedHost.jobs.background(id)
          return yield* backgroundedResult(id, calls, readPartial)
        }

        const outcome = yield* resolvedHost.jobs
          .block<ExecuteOutput>({
            id,
            sessionID: context.sessionID,
            yield_after: input.yield_after ?? Job.DEFAULT_YIELD_AFTER_MS,
            deferYield:
              input.yield_after === undefined
                ? Ref.get(waitingJobs).pipe(Effect.map((count) => count > 0))
                : undefined,
          })
          .pipe(Effect.onInterrupt(() => resolvedHost.jobs.cancel(id).pipe(Effect.ignore)))

        if (outcome?.type === "backgrounded") {
          yield* Ref.set(yielded, true)
          return yield* backgroundedResult(id, calls, readPartial)
        }
        if (outcome?.info.value) return completedResult(outcome.info.value)
        const fallback: ExecuteOutput = {
          output: outcome?.info.error ?? outcome?.info.output ?? "Code Mode execution cancelled",
          toolCalls: yield* Ref.get(calls),
          files: [],
          error: true,
        }
        return completedResult(fallback)
      }),
  } satisfies Info
}

function completedResult(value: ExecuteOutput) {
  const content: Array<Content> = [
    { type: "text", text: value.output },
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
}

function backgroundedResult(
  id: string,
  calls: Ref.Ref<Array<ExecuteCall>>,
  readPartial: Effect.Effect<string | undefined>,
) {
  return Effect.gen(function* () {
    const toolCalls = yield* Ref.get(calls)
    const partial = yield* readPartial
    const text = [
      `Code Mode execution moved to the background (jobID: ${id}).`,
      ...(partial ? [`Output so far:\n${partial}`] : []),
      BACKGROUND_INSTRUCTION,
    ].join("\n\n")
    const value: ExecuteOutput = {
      output: text,
      toolCalls,
      files: [],
      status: "running",
      jobID: id,
    }
    return {
      output: value,
      content: [{ type: "text" as const, text }],
      metadata: {
        toolCalls,
        status: "running",
        jobID: id,
      },
    }
  })
}

function formatPartial(logs: ReadonlyArray<string>, toolCalls: ReadonlyArray<ExecuteCall>): string | undefined {
  const parts = [
    ...(logs.length > 0 ? [`Logs:\n${logs.join("\n")}`] : []),
    ...(toolCalls.length > 0
      ? [`Tool calls:\n${toolCalls.map((call) => `- [${call.status}] ${call.tool}`).join("\n")}`]
      : []),
  ]
  return parts.length > 0 ? parts.join("\n\n") : undefined
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
          return start(call, { tool: call.name, status: "running", input: CodeModeWeb.display(call.args) })
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
      signature: tool.signature,
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
const runtimes = new WeakMap<Inventory, CodeMode.Runtime<Run>>()

function runtime(inventory: Inventory) {
  const cached = runtimes.get(inventory)
  if (cached) return cached
  const tools = inventoryTools(inventory)
  const created = CodeMode.make<typeof tools, [typeof CodeModeWeb.extension]>({
    tools,
    extensions: [CodeModeWeb.extension],
    hooks: runHooks,
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
  executeTool: (name: string, tool: Info, input: unknown) => Effect.Effect<Result, Error>,
) =>
  CodeMode.make({ tools: inventoryTools(inventory), hooks: runHooks, limits })
    .execute(code, bindings)
    .pipe(
      Effect.provideService(Run, {
        executeTool: (name, tool, input) => executeTool(name, tool, input).pipe(Effect.map(resultValue)),
        hooks: {},
      }),
    )

function inventoryTools(inventory: Inventory) {
  // A path may carry namespace metadata, a callable tool, child tools, or all three.
  const root: ToolNode = { children: new Map() }
  for (const namespace of inventory.namespaces?.values() ?? []) getNode(root, namespace.name).namespace = namespace
  for (const [name, registration] of inventory.tools) {
    const child = definition(registration)
    getNode(root, qualifiedName(registration)).tool = Tool.make({
      description: child.description,
      input: child.inputSchema,
      output: child.outputSchema ?? Schema.NullOr(Schema.String),
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

function formatValue(value: CodeMode.DataValue) {
  if (typeof value === "string") return value
  return JSON.stringify(value, null, 2) ?? String(value)
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
