export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@opencode/schema/tool"
export type { Context, Dynamic, Info, Metadata, Namespace, Options, Result } from "@opencode/schema/tool"

import { ToolDefinition, type ToolCall } from "@opencode/ai/effect"
import type { CodeMode } from "@opencode/codemode"
import { Tool } from "@opencode/schema/tool"
import { Context, Effect, Layer, Ref, Result, Schema, SchemaIssue, Types } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeJob } from "./codemode/job.js"
import { CodeModeTool } from "./codemode/tool.js"
import { Flag } from "./flag.js"
import { Image } from "./image.js"
import { Permission } from "./permission.js"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import {
  definition,
  effectiveName,
  execute,
  isDynamicField,
  normalizedName,
  normalizeContent,
  resolveField,
} from "./tool/runtime.js"
import { Wildcard } from "./util/wildcard.js"

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

type SourceTool = Tool.Info & { readonly id: string }
type FormTool = Tool.Info.Form & { readonly id: string }

export interface Editor {
  readonly list: () => readonly SourceTool[]
  readonly get: (id: string) => SourceTool | undefined
  readonly namespace: (namespace: Tool.Namespace) => void
  readonly add: <
    Input extends Tool.ValueSchema<any> = Tool.ValueSchema<any>,
    Output extends Tool.ValueSchema<any> | undefined = Tool.ValueSchema<any> | undefined,
  >(
    tool: Tool.Info<Input, Output>,
  ) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Entry = {
  readonly source: SourceTool
  // Resolved and converted once per registration; schemas cannot change without re-registering the tool.
  readonly direct: {
    readonly info: FormTool
    readonly definition: ToolDefinition
  }
  readonly codeMode?: {
    readonly info: FormTool
  }
}

type Data = {
  tools: Map<string, Entry>
  namespaces: Map<string, Tool.Namespace>
  errors: { kind: "tool" | "namespace"; name: string; namespace?: string; error: RegistrationError }[]
}

export interface Policy {
  readonly hidden?: ReadonlySet<string>
  readonly codemode?: ReadonlySet<string>
}

export interface SnapshotOptions {
  /**
   * With `full_codemode`, Code Mode gets the experimental `path` and `Bun` globals, which act through `services`: the
   * session's Location and file services.
   */
  readonly services?: Context.Context<CodeModeTool.Services>
  readonly tools?: Policy
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: () => Effect.Effect<ReadonlyArray<SourceTool>>
  readonly snapshot: (permissions?: Permission.Ruleset, options?: SnapshotOptions) => Effect.Effect<Snapshot>
  /**
   * Runs a Code Mode program with no model step over only the Code Mode tools named in `tools` (still subject to
   * whole-tool permission filtering and each tool's own executor policy), with no `fetch`.
   */
  readonly check: (input: CheckInput) => Effect.Effect<CodeMode.Result>
}

export interface CheckInput {
  readonly code: string
  readonly tools: ReadonlyArray<string>
  readonly bindings: Readonly<Record<string, CodeMode.DataValue>>
  readonly permissions: Permission.Ruleset
  readonly limits: CodeMode.ExecutionLimits
  readonly context: Omit<Tool.Context, "id">
}

/** A local execution result after hooks and content normalization. */
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

    const beforeExecute = (name: string, info: Tool.Info | undefined, input: unknown, context: Tool.Context) =>
      hooks.trigger("tool", "execute.before", {
        tool: name,
        ...(info === undefined ? {} : { info }),
        codeMode: context.codeMode === true,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      })

    const executeTool = Effect.fn("Tool.execute")(function* (
      form: Tool.Info.Form,
      info: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      yield* Effect.annotateCurrentSpan({
        "gen_ai.tool.name": name,
        "gen_ai.tool.call.id": context.id,
        "session.id": context.sessionID,
        "gen_ai.agent.name": context.agent,
      })
      const execution = yield* execute(form, input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        info,
        codeMode: context.codeMode === true,
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

    type Executable = {
      readonly source: Tool.Info
      readonly form: Tool.Info.Form
    }

    // A plugin may rename a call in a Code Mode program, as it may a direct call, to another of the program's tools.
    const run = Effect.fnUntraced(function* (
      tools: ReadonlyMap<string, Executable>,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const initial = tools.get(name)
      const event = yield* beforeExecute(name, initial?.source, input, context)
      const selected = event.tool === name ? initial : tools.get(event.tool)
      if (!selected) return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
      return yield* executeTool(selected.form, selected.source, event.tool, event.input, context)
    })

    type CachedCatalog = {
      readonly entries: ReadonlyMap<string, Executable>
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
        namespaces: new Map(),
        errors: [],
      }),
      editor: (editor) => ({
        list: () => Array.from(editor.tools.values(), (entry) => entry.source),
        get: (id) => editor.tools.get(id)?.source,
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
          commit(editor, id, { ...(tool as Tool.Info), id })
        },
        update: (id, update) => {
          const current = editor.tools.get(id)?.source
          if (!current) return
          const draft: Types.Mutable<SourceTool> = {
            ...current,
            options: current.options && { ...current.options },
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

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      list: () => Effect.sync(() => Array.from(state.get().tools.values(), (entry) => entry.source)),
      snapshot: Effect.fn("Tool.snapshot")((permissions, options) =>
        Effect.gen(function* () {
          const rules = permissions ?? []
          // Without Code Mode its tools would be unreachable, so expose them as direct tools instead.
          const codeModeEnabled = !whollyDisabled("execute", rules)
          const full = codeModeEnabled && options?.services !== undefined && (yield* flags.enabled("full_codemode"))
          const data = state.get()
          if (catalogData !== data) {
            catalogData = data
            catalogs.clear()
          }
          const hidden = options?.tools?.hidden
          const promoted = options?.tools?.codemode
          const direct = new Map<string, Entry>()
          const codeModeEntries: Array<[string, Entry]> = []
          for (const [name, entry] of data.tools) {
            const tool = entry.source
            if (hidden?.has(name)) continue
            if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
            if (codeModeEnabled && (tool.options?.codemode !== false || promoted?.has(name))) {
              codeModeEntries.push([name, entry])
              continue
            }
            direct.set(name, entry)
          }
          const codeMode = !codeModeEnabled
            ? undefined
            : (() => {
                const key = `${full ? "1" : "0"}\0${codeModeEntries.map(([name]) => name).join("\0")}`
                // Discovery is immutable for a registry revision and visible tool set. Keep executors
                // fresh, but share the inventory, whose prepared runtime and much larger rendered catalog
                // are cached by identity, and the execute tool's definition across steps.
                const cached = catalogs.get(key)
                if (cached) {
                  catalogs.delete(key)
                  catalogs.set(key, cached)
                }
                const entries =
                  cached?.entries ??
                  new Map(
                    codeModeEntries.map(([name, entry]) => [
                      name,
                      { source: entry.source, form: entry.codeMode?.info ?? entry.direct.info },
                    ]),
                  )
                const inventory = cached?.inventory ?? {
                  tools: new Map(Array.from(entries, ([name, entry]) => [name, entry.form])),
                  namespaces: data.namespaces,
                }
                const tool = CodeModeTool.create(
                  inventory,
                  (name, _item, input, context) => run(entries, name, input, context),
                  permission,
                  full ? options.services : undefined,
                )
                const entry = cached ?? {
                  entries,
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
                return { tool, catalog: entry.value, definition: entry.definition }
              })()
          return {
            ...(codeMode === undefined ? {} : { codeModeCatalog: codeMode.catalog }),
            definitions: [
              ...Array.from(direct)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([, entry]) => entry.direct.definition),
              ...(codeMode ? [codeMode.definition] : []),
            ],
            execute: Effect.fnUntraced(function* (input: Parameters<Snapshot["execute"]>[0]) {
              const context: Tool.Context = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
                cancel: input.cancel,
              }
              const initialName = input.definitions?.get(input.call.name)?.name ?? input.call.name
              const initial = initialName === "execute" && codeMode ? codeMode.tool : direct.get(initialName)?.source
              const event = yield* beforeExecute(input.call.name, initial, input.call.input, context)
              const requested = input.definitions?.get(event.tool)
              // Preserve session context removal and alias resolution, now after the repair hook.
              if (!requested && input.definitions && (direct.has(event.tool) || codeMode?.tool.name === event.tool))
                return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
              const name = requested?.name ?? event.tool
              if (name === "execute" && codeMode) {
                const run = (ctx: Tool.Context) => executeTool(codeMode.tool, codeMode.tool, name, event.input, ctx)
                const background = yield* CodeModeJob.Current
                return yield* background ? background(context, run) : run(context)
              }
              const entry = direct.get(name)
              if (entry) return yield* executeTool(entry.direct.info, entry.source, name, event.input, context)
              return yield* new Tool.Error({
                message: `No tool named "${name}" is currently available. Please use a tool from the available tool list.`,
              })
            }),
          }
        }),
      ),
      check: Effect.fn("Tool.check")(function* (input) {
        if (whollyDisabled("execute", input.permissions)) {
          return {
            ok: false,
            error: { kind: "ExecutionFailure", message: "Code Mode is disabled for this agent" },
            toolCalls: [],
          } satisfies CodeMode.Result
        }
        const data = state.get()
        const allowed = new Set(input.tools)
        const entries = new Map(
          Array.from(data.tools)
            .filter(
              ([name, entry]) =>
                entry.source.options?.codemode !== false &&
                allowed.has(CodeModeTool.qualifiedName(entry.source)) &&
                !whollyDisabled(entry.source.options?.permission ?? name, input.permissions),
            )
            .map(([name, entry]) => [name, { source: entry.source, form: entry.codeMode?.info ?? entry.direct.info }]),
        )
        const tools = new Map(Array.from(entries, ([name, entry]) => [name, entry.form]))
        const callSeq = yield* Ref.make(0)
        return yield* CodeModeTool.check(
          { tools, namespaces: data.namespaces },
          input.code,
          input.bindings,
          input.limits,
          (name, _tool, toolInput) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callSeq, (value) => value + 1)
              const context: Tool.Context = {
                ...input.context,
                id: Tool.CallID.make(`call_${input.context.messageID}_${index}`),
                codeMode: true,
              }
              return yield* run(entries, name, toolInput, context)
            }),
        )
      }),
    })
  }),
)

/** Store a valid tool under its effective name, or record why it was skipped. */
function commit(editor: Data, id: string, input: Tool.Info & { readonly id: string }) {
  const source = { ...input, options: input.options && { ...input.options } }
  const registered = register(id, source)
  if (Result.isFailure(registered)) {
    editor.errors.push({
      kind: "tool",
      name: source.name,
      namespace: source.options?.namespace,
      error: registered.failure,
    })
    return
  }
  editor.tools.set(id, registered.success)
}

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const CATALOG_CACHE_LIMIT = 5

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

const emptyInput = {}

function resolveForm(source: SourceTool, codeMode: boolean): FormTool {
  const rawInput = resolveField(source.input, codeMode)
  // JavaScript plugins may leave out `input` for a tool that takes none.
  const input = rawInput === undefined || rawInput === null ? emptyInput : rawInput
  const output = resolveField(source.output, codeMode)
  return {
    ...source,
    description: resolveField(source.description, codeMode),
    input,
    ...(output === undefined ? { output: undefined } : { output }),
  }
}

const hasDynamicFields = (tool: Tool.Info) =>
  isDynamicField(tool.description) || isDynamicField(tool.input) || isDynamicField(tool.output)

function register(id: string, source: Tool.Info & { readonly id: string }): Result.Result<Entry, RegistrationError> {
  const namespace = source.options?.namespace
  if (namespace !== undefined) {
    const error = namespaceError(namespace)
    if (error) return Result.fail(error)
  }
  const name = normalizedName(source)
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    return Result.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))
  if (source.options?.codemode === false && id === "execute")
    return Result.fail(new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' }))

  const directForm = Result.try({
    try: () => resolveForm(source, false),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  if (Result.isFailure(directForm)) return Result.fail(directForm.failure)
  // Standard Schema libraries such as ArkType make schemas that are functions.
  if (typeof directForm.success.input !== "object" && typeof directForm.success.input !== "function")
    return Result.fail(
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: input must be a schema` }),
    )
  const directDef = Result.try({
    try: () => ToolDefinition.make(definition(directForm.success)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  if (Result.isFailure(directDef)) return Result.fail(directDef.failure)

  if (!hasDynamicFields(source)) {
    return Result.succeed({
      source,
      direct: { info: directForm.success, definition: directDef.success },
      ...(source.options?.codemode === false ? {} : { codeMode: { info: directForm.success } }),
    })
  }

  const codeModeForm = Result.try({
    try: () => resolveForm(source, true),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  if (Result.isFailure(codeModeForm)) return Result.fail(codeModeForm.failure)
  if (typeof codeModeForm.success.input !== "object" && typeof codeModeForm.success.input !== "function")
    return Result.fail(
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: input must be a schema` }),
    )
  if (typeof codeModeForm.success.description !== "string")
    return Result.fail(
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: expected string description` }),
    )
  if (
    codeModeForm.success.input !== directForm.success.input ||
    codeModeForm.success.output !== directForm.success.output
  ) {
    const codeModeDef = Result.try({
      try: () => ToolDefinition.make(definition(codeModeForm.success)),
      catch: (error) =>
        new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
    })
    if (Result.isFailure(codeModeDef)) return Result.fail(codeModeDef.failure)
  }
  return Result.succeed({
    source,
    direct: { info: directForm.success, definition: directDef.success },
    codeMode: { info: codeModeForm.success },
  })
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
