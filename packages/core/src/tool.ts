export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@opencode/schema/tool"
export type { Calls, Context, Info, Metadata, Namespace, Options, Result } from "@opencode/schema/tool"

import { ToolDefinition, type ToolCall } from "@opencode/ai/effect"
import type { CodeMode } from "@opencode/codemode"
import { Tool } from "@opencode/schema/tool"
import { Identifier } from "@opencode/schema/identifier"
import { isRecord } from "@opencode/util/record"
import { Context, Effect, Layer, Ref, Result, Schema, SchemaIssue, Stream, Types } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeJob } from "./codemode/job.js"
import { CodeModeTool } from "./codemode/tool.js"
import { Flag } from "./flag.js"
import { Image } from "./image.js"
import { Permission } from "./permission.js"
import { PermissionPolicy } from "./permission/policy.js"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import {
  defaultCodeMode,
  definition,
  effectiveName,
  execute,
  normalizedName,
  normalizeContent,
} from "./tool/runtime.js"

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

type RegisteredTool = Tool.Info & { readonly id: string }

export interface Editor {
  readonly list: () => readonly RegisteredTool[]
  readonly get: (id: string) => RegisteredTool | undefined
  readonly namespace: (namespace: Tool.Namespace) => void
  readonly add: <
    Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
    Output extends Tool.ValueSchema<any> | undefined = undefined,
    CMInput extends Tool.ValueSchema<any> = Input,
    CMOutput extends Tool.ValueSchema<any> | undefined = Output,
  >(
    tool: Tool.Info<Input, Output, CMInput, CMOutput>,
  ) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Data = {
  tools: Map<string, RegisteredTool>
  // Converted once at registration; schemas cannot change without re-registering the tool.
  definitions: Map<string, ToolDefinition>
  namespaces: Map<string, Tool.Namespace>
  errors: { kind: "tool" | "namespace"; name: string; namespace?: string; error: RegistrationError }[]
}

export interface Policy {
  readonly hidden?: ReadonlySet<string>
  readonly direct?: ReadonlySet<string>
}

export interface SnapshotOptions {
  /**
   * With `full_codemode`, Code Mode gets the experimental `path` and `Bun` globals, which act through `services`: the
   * session's Location and file services.
   */
  readonly services?: Context.Context<CodeModeTool.Services>
  /** What `opencode://` fetch sends requests through; see the `opencode_api` flag. */
  readonly api?: Context.Context<CodeModeTool.Api>
  /** With `codemode_agents`, what runs Code Mode's agent() and llm(). */
  readonly agents?: Context.Context<CodeModeTool.Agents>
  readonly tools?: Policy
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: () => Effect.Effect<ReadonlyArray<RegisteredTool>>
  readonly codeModeTools: (paths: ReadonlyArray<string>) => Effect.Effect<ReadonlyMap<string, RegisteredTool>>
  readonly snapshot: (policy?: PermissionPolicy.Policy, options?: SnapshotOptions) => Effect.Effect<Snapshot>
  /**
   * Runs a Code Mode program with no model step over only the Code Mode tools named in `tools` (still subject to
   * whole-tool permission filtering and each tool's own executor policy).
   */
  readonly check: (input: CheckInput) => Effect.Effect<CodeMode.Result>
}

export interface CheckInput {
  readonly code: string
  readonly tools: ReadonlyArray<string>
  readonly bindings: Readonly<Record<string, CodeMode.DataValue>>
  readonly policy: PermissionPolicy.Policy
  readonly limits: CodeMode.ExecutionLimits
  readonly services?: Context.Context<CodeModeTool.Services>
  readonly context: Omit<Tool.Context, "id" | "tool">
}

/** A local execution result after hooks and content normalization. */
/** A call's context before `tool.call` is bound to it. */
type Call = Omit<Tool.Context, "tool">

export interface NormalizedResult extends Tool.Result {
  readonly content: ReadonlyArray<Tool.Content>
}

export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: CodeModeCatalog.Inventory
  readonly execute: (input: {
    readonly sessionID: SessionSchema.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly call: ToolCall
    readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
    /** Completes when the user asks the call to stop; see `Tool.Context.cancel`. */
    readonly cancel?: Effect.Effect<void>
    /** Surviving request definitions, keyed by the names advertised after session context hooks. */
    readonly definitions?: ReadonlyMap<string, ToolDefinition>
  }) => Effect.Effect<NormalizedResult, Tool.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const image = yield* Image.Service
    const permission = yield* Permission.Service
    const flags = yield* Flag.Service

    type NormalizedItem = Tool.Content | "decode" | "size"
    const normalizeImages = Effect.fnUntraced(function* (content: ReadonlyArray<Tool.Content>) {
      const normalized = yield* Effect.forEach(content, (item): Effect.Effect<NormalizedItem> => {
        if (item.type !== "file" || !item.mime.startsWith("image/")) return Effect.succeed(item)
        const base64 = /^data:[^,]*;base64,(.*)$/s.exec(item.uri)?.[1]
        if (base64 === undefined) return Effect.succeed(item)
        const resource = item.name ?? `${item.mime} tool output`
        return image.normalize(resource, { uri: resource, content: base64, encoding: "base64", mime: item.mime }).pipe(
          Effect.map((result) => ({
            ...item,
            uri: `data:${result.mime};base64,${result.content}`,
            mime: result.mime,
          })),
          Effect.catchTag("Image.ResizerUnavailableError", () => Effect.succeed(item)),
          Effect.catchTag("Image.DecodeError", () => Effect.succeed("decode" as const)),
          Effect.catchTag("Image.SizeError", () => Effect.succeed("size" as const)),
        )
      })
      const note = (reason: "decode" | "size", text: string) => {
        const count = normalized.filter((item) => item === reason).length
        if (count === 0) return []
        return [{ type: "text" as const, text: `[${count} image${count === 1 ? "" : "s"} omitted: ${text}]` }]
      }
      return [
        ...normalized.filter((item) => typeof item !== "string"),
        ...note("decode", "could not be decoded."),
        ...note("size", "could not be resized below the image size limit."),
      ]
    })

    const beforeExecute = (name: string, info: Tool.Info | undefined, input: unknown, context: Call) =>
      hooks.trigger("tool", "execute.before", {
        tool: name,
        ...(info === undefined ? {} : { info }),
        codemode: context.codemode === true,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      })

    const executeTool = Effect.fn("Tool.execute")(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Call,
      reachable: ReadonlyMap<string, Tool.Info>,
    ) {
      yield* Effect.annotateCurrentSpan({
        "gen_ai.tool.name": name,
        "gen_ai.tool.call.id": context.id,
        "session.id": context.sessionID,
        "gen_ai.agent.name": context.agent,
      })
      const execution = yield* execute(tool, input, { ...context, tool: calls(reachable, context) }).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        info: tool,
        codemode: context.codemode === true,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      }
      if ("failure" in execution) {
        const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
          ...base,
          status: "error",
          error: execution.failure,
        }
        yield* hooks.trigger("tool", "execute.after", afterEvent)
        return yield* afterEvent.error
      }
      const afterEvent: PluginHooks.Domains["tool"]["execute.after"] = {
        ...base,
        status: "completed",
        result: {
          ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
          content: execution.value.content,
          ...(execution.value.metadata === undefined ? {} : { metadata: execution.value.metadata }),
        },
      }
      yield* hooks.trigger("tool", "execute.after", afterEvent)
      const afterContent = yield* normalizeImages(normalizeContent(afterEvent.result.content, afterEvent.result.output))
      return {
        ...(afterEvent.result.output === undefined ? {} : { output: afterEvent.result.output }),
        content: afterContent,
        ...(afterEvent.result.metadata === undefined ? {} : { metadata: afterEvent.result.metadata }),
      }
    })

    // A plugin may rename a call in a Code Mode program, as it may a direct call, to another of the program's tools.
    const run = Effect.fnUntraced(function* (
      tools: ReadonlyMap<string, Tool.Info>,
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Call,
      reachable: ReadonlyMap<string, Tool.Info> = tools,
    ) {
      const event = yield* beforeExecute(name, tool, input, context)
      const selected = event.tool === name ? tool : tools.get(event.tool)
      if (!selected) return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
      return yield* executeTool(selected, event.tool, event.input, context, reachable)
    })

    // `tool.call` for a call: runs another of the tools it may reach as a nested call, whose permission requests show
    // on the call the model made.
    const calls = (tools: ReadonlyMap<string, Tool.Info>, parent: Call): Tool.Calls => ({
      call: (name, input) =>
        Effect.gen(function* () {
          const found = CodeModeTool.find({ tools }, name)
          if (!found) return yield* new Tool.Error({ message: `No tool named "${name}" is available to this call.` })
          const id = Tool.CallID.make(`call_${Identifier.ascending()}`)
          yield* permission.nested(id, parent.id)
          return yield* run(tools, found.registration, found.id, input, {
            ...parent,
            id,
            // Progress belongs to the outer call, and a stop is its to handle.
            progress: () => Effect.void,
            cancel: undefined,
          })
        }).pipe(Effect.scoped),
    })

    type CachedCatalog = {
      readonly inventory: CodeModeTool.Inventory
      readonly value: CodeModeCatalog.Inventory
      readonly definition: ToolDefinition
    }
    let catalogData: Data | undefined
    const catalogs = new Map<string, CachedCatalog>()
    const state = State.create<Data, Editor>({
      name: "tool",
      initial: () => ({
        tools: new Map(),
        definitions: new Map(),
        namespaces: new Map(),
        errors: [],
      }),
      editor: (editor) => ({
        list: () => Array.from(editor.tools.values()),
        get: (id) => editor.tools.get(id),
        namespace: (namespace) => {
          const error = namespaceError(namespace.name)
          if (error) {
            editor.errors.push({ kind: "namespace", name: namespace.name, namespace: namespace.name, error })
            return
          }
          editor.namespaces.set(namespace.name, { ...namespace })
        },
        add: (tool) => {
          const id = effectiveName(tool)
          commit(editor, id, { ...tool, id })
        },
        update: (id, update) => {
          const current = editor.tools.get(id)
          if (!current) return
          const draft: Types.Mutable<RegisteredTool> = {
            ...current,
            options: cloneOptions(current.options),
          }
          update(draft)
          draft.name = current.name
          draft.id = id
          if (draft.options?.namespace !== current.options?.namespace)
            draft.options = { ...draft.options, namespace: current.options?.namespace }
          commit(editor, id, draft)
        },
        remove: (id) => {
          editor.tools.delete(id)
          editor.definitions.delete(id)
        },
      }),
      notify: (value) => {
        catalogData = undefined
        catalogs.clear()
        return Effect.forEach(
          value.errors,
          ({ kind, name, namespace, error }) =>
            Effect.logError(`Skipping invalid ${kind} registration`, {
              name,
              namespace,
              error: error.message,
            }),
          { discard: true },
        )
      },
    })

    yield* flags.changes().pipe(
      Stream.runForEach(() => state.reload()),
      Effect.forkScoped({ startImmediately: true }),
    )

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: () => Effect.sync(() => Array.from(state.get().tools.values())),
      codeModeTools: (paths) => Effect.sync(() => new Map(codeModeTools(state.get().tools, paths))),
      snapshot: Effect.fn("Tool.snapshot")((input, options) =>
        Effect.gen(function* () {
          const policy = input ?? PermissionPolicy.empty
          // Without Code Mode its tools would be unreachable, so expose them as direct tools instead.
          const codeModeEnabled = codeModeAvailable(policy)
          const full = codeModeEnabled && options?.services !== undefined && (yield* flags.enabled("full_codemode"))
          const data = state.get()
          if (catalogData !== data) {
            catalogData = data
            catalogs.clear()
          }
          const hidden = options?.tools?.hidden
          const keepDirect = options?.tools?.direct
          const direct = new Map<string, Tool.Info>()
          const codemodeEntries: Array<[string, Tool.Info]> = []
          for (const [name, tool] of data.tools) {
            if (hidden?.has(name)) continue
            if (PermissionPolicy.isActionDenied(policy, tool.options?.permission ?? name)) continue
            if (codeModeEnabled && defaultCodeMode(tool) && !keepDirect?.has(name)) {
              codemodeEntries.push([name, tool])
              continue
            }
            direct.set(name, tool)
          }
          // Every tool this request offers, directly or inside Code Mode, which a call's `tool.call` may reach.
          const reachable = new Map([...direct, ...codemodeEntries])
          const codemode = !codeModeEnabled
            ? undefined
            : (() => {
                const key = `${full ? "1" : "0"}\0${codemodeEntries.map(([name]) => name).join("\0")}`
                // Discovery is immutable for a registry revision and visible tool set. Keep executors
                // fresh, but share the inventory, whose prepared runtime and much larger rendered catalog
                // are cached by identity, and the execute tool's definition across steps.
                const cached = catalogs.get(key)
                if (cached) {
                  catalogs.delete(key)
                  catalogs.set(key, cached)
                }
                const inventory = cached?.inventory ?? {
                  tools: new Map(codemodeEntries),
                  namespaces: data.namespaces,
                  definitions: data.definitions,
                }
                const tool = CodeModeTool.create(
                  inventory,
                  (name, item, input, context) => run(inventory.tools, item, name, input, context, reachable),
                  permission,
                  full ? options.services : undefined,
                  options?.api,
                  options?.agents,
                )
                const entry = cached ?? {
                  inventory,
                  value: CodeModeTool.catalog(inventory),
                  definition: definition(tool),
                }
                if (!cached) {
                  if (catalogs.size >= CATALOG_CACHE_LIMIT) {
                    const oldest = catalogs.keys().next().value
                    if (oldest !== undefined) catalogs.delete(oldest)
                  }
                  catalogs.set(key, entry)
                }
                return { tool, inventory, catalog: entry.value, definition: entry.definition }
              })()
          return {
            ...(codemode === undefined ? {} : { codeModeCatalog: codemode.catalog }),
            definitions: [
              ...Array.from(direct)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([name]) => data.definitions.get(name)!),
              ...(codemode ? [codemode.definition] : []),
            ],
            execute: Effect.fnUntraced(function* (input: Parameters<Snapshot["execute"]>[0]) {
              const call: Call = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
                cancel: input.cancel,
              }
              const context: Tool.Context = { ...call, tool: calls(reachable, call) }
              const initialName = input.definitions?.get(input.call.name)?.name ?? input.call.name
              const initial = initialName === "execute" && codemode ? codemode.tool : direct.get(initialName)
              const event = yield* beforeExecute(input.call.name, initial, input.call.input, context)
              const requested = input.definitions?.get(event.tool)
              // Preserve session context removal and alias resolution, now after the repair hook.
              if (!requested && input.definitions && (direct.has(event.tool) || codemode?.tool.name === event.tool))
                return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
              const name = requested?.name ?? event.tool
              // A tool this request only offers inside Code Mode, called by the model at the top level or renamed there by
              // a plugin, runs as a Code Mode call when the request offered execute.
              const found =
                codemode &&
                name !== "execute" &&
                !direct.has(name) &&
                (!input.definitions || Array.from(input.definitions.values()).some((item) => item.name === "execute"))
                  ? CodeModeTool.find(codemode.inventory, name)
                  : undefined
              if (codemode && (name === "execute" || found)) {
                // Like an execute program, it moves to the background when it runs long.
                const run = (ctx: Tool.Context) =>
                  found
                    ? executeTool(found.registration, found.id, event.input, { ...ctx, codemode: true }, reachable)
                    : executeTool(codemode.tool, name, event.input, ctx, reachable)
                const background = yield* CodeModeJob.Current
                return yield* background
                  ? background(context, run, full && !found ? executeOptions(event.input) : undefined)
                  : run(context)
              }
              const tool = direct.get(name)
              if (tool) return yield* executeTool(tool, name, event.input, context, reachable)
              return yield* new Tool.Error({
                message: `No tool named "${name}" is currently available. Please use a tool from the available tool list.`,
              })
            }),
          }
        }),
      ),
      check: Effect.fn("Tool.check")(function* (input) {
        if (PermissionPolicy.isActionDenied(input.policy, "execute")) {
          return {
            ok: false,
            error: { kind: "ExecutionFailure", message: "Code Mode is disabled for this agent" },
            toolCalls: [],
          } satisfies CodeMode.Result
        }
        const data = state.get()
        const tools = new Map(
          codeModeTools(data.tools, input.tools)
            .filter(([, tool]) => !PermissionPolicy.isActionDenied(input.policy, tool.options?.permission ?? tool.id))
            .map(([, tool]) => [tool.id, tool] as const),
        )
        const callSeq = yield* Ref.make(0)
        const full = input.services !== undefined && (yield* flags.enabled("full_codemode"))
        return yield* CodeModeTool.check(
          { tools, namespaces: data.namespaces, definitions: data.definitions },
          {
            ...input,
            context: (() => {
              const call = { ...input.context, id: Tool.CallID.make(`call_${input.context.messageID}_execute`) }
              return { ...call, tool: calls(tools, call) }
            })(),
            permission,
            services: full ? input.services : undefined,
          },
          (name, tool, toolInput) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callSeq, (value) => value + 1)
              const context: Call = {
                ...input.context,
                id: Tool.CallID.make(`call_${input.context.messageID}_${index}`),
                codemode: true,
              }
              return yield* run(tools, tool, name, toolInput, context)
            }),
        )
      }),
    })
  }),
)

const cloneOptions = (options: Tool.Options | undefined): Tool.Options | undefined =>
  options && {
    ...options,
    ...(isRecord(options.codemode) ? { codemode: { ...options.codemode } } : {}),
  }

/** Store a valid tool under its effective name, or record why it was skipped. */
function commit(editor: Data, id: string, input: RegisteredTool) {
  // JavaScript plugins may leave out `input` for a tool that takes none.
  const tool = {
    ...input,
    input: input.input === undefined || input.input === null ? {} : input.input,
    options: cloneOptions(input.options),
  }
  const registered = register(id, tool)
  if (Result.isFailure(registered)) {
    editor.errors.push({
      kind: "tool",
      name: tool.name,
      namespace: tool.options?.namespace,
      error: registered.failure,
    })
    return
  }
  editor.tools.set(id, tool)
  editor.definitions.set(id, registered.success)
}

function* codeModeTools(registered: Data["tools"], paths: ReadonlyArray<string>) {
  for (const path of paths) {
    const tool = registered.get(path.replaceAll(".", "_"))
    if (tool && defaultCodeMode(tool) && CodeModeTool.qualifiedName(tool) === path) yield [path, tool] as const
  }
}

/** Whether the policy leaves Code Mode's `execute` reachable, as `snapshot` decides it. */
export const codeModeAvailable = (policy: PermissionPolicy.Policy) =>
  !PermissionPolicy.isActionDenied(policy, "execute")

const CATALOG_CACHE_LIMIT = 5

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

const isSchemaValue = (value: unknown) => (typeof value === "object" && value !== null) || typeof value === "function"

function register(id: string, tool: Tool.Info): Result.Result<ToolDefinition, RegistrationError> {
  const namespace = tool.options?.namespace
  if (namespace !== undefined) {
    const error = namespaceError(namespace)
    if (error) return Result.fail(error)
  }
  const name = normalizedName(tool)
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    return Result.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))
  if (!defaultCodeMode(tool) && id === "execute")
    return Result.fail(new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' }))
  // Standard Schema libraries such as ArkType make schemas that are functions.
  if (!isSchemaValue(tool.input))
    return Result.fail(
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: input must be a schema` }),
    )
  const direct = Result.try({
    try: () => ToolDefinition.make(definition(tool)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  if (Result.isFailure(direct)) return Result.fail(direct.failure)
  const codemode = tool.options?.codemode
  if (codemode === undefined || typeof codemode === "boolean") return direct
  if (!isRecord(codemode))
    return Result.fail(
      new RegistrationError({
        name: id,
        message: `Invalid tool definition ${id}: options.codemode must be a boolean or object`,
      }),
    )
  if (codemode.input !== undefined && !isSchemaValue(codemode.input))
    return Result.fail(
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: input must be a schema` }),
    )
  const overridden = Result.try({
    try: () => ToolDefinition.make(definition(tool, true)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  if (Result.isFailure(overridden)) return Result.fail(overridden.failure)
  return direct
}

function namespaceError(name: string) {
  if (name.split(".").every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return
  return new RegistrationError({ name, message: `Invalid tool namespace: ${JSON.stringify(name)}` })
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node, Permission.node, Flag.node],
})

// Only read once the input has the shape the full_codemode schema accepts; the tool still validates it when it runs.
const executeOptions = (input: unknown): CodeModeJob.Options | undefined => {
  if (typeof input !== "object" || input === null) return undefined
  const { timeout, background } = input as Record<string, unknown>
  return {
    ...(typeof timeout === "number" && Number.isInteger(timeout) && timeout > 0 ? { timeout } : {}),
    ...(background === true ? { background } : {}),
  }
}
