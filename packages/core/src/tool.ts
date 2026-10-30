export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@opencode/schema/tool"
export type { Context, Metadata, Namespace, Options, Result } from "@opencode/schema/tool"

import { ToolDefinition, type ToolCall } from "@opencode/ai/effect"
import type { CodeMode } from "@opencode/codemode"
import { Identifier } from "@opencode/schema/identifier"
import { Tool } from "@opencode/schema/tool"
import { isRecord } from "@opencode/util/record"
import { Cause, Context, Effect, Layer, Option, Ref, Result, Schema, SchemaIssue, Types } from "effect"
import { makeLocationNode } from "@opencode/util/effect/app-node"
import { extension } from "mime-types"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeTool } from "./codemode/tool.js"
import { Form } from "./form.js"
import { Image } from "./image.js"
import { Job } from "./job.js"
import { Permission } from "./permission.js"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import { ToolOutput } from "./tool-output.js"
import { definition, effectiveName, execute, normalizedName, normalizeContent } from "./tool/runtime.js"
import { Wildcard } from "./util/wildcard.js"

const BACKGROUND_TOOL_INSTRUCTION =
  "You will be notified automatically when execution finishes, with its output. DO NOT re-run this call, sleep, or poll in loops; continue with independent work or end your response and wait to be resumed."

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Editor {
  readonly list: () => readonly (Tool.Info & { readonly id: string })[]
  readonly get: (id: string) => (Tool.Info & { readonly id: string }) | undefined
  readonly namespace: (namespace: Tool.Namespace) => void
  readonly add: (tool: Tool.Info) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Data = {
  tools: Map<string, Tool.Info & { readonly id: string }>
  // Converted once at registration; schemas cannot change without re-registering the tool.
  definitions: Map<string, ToolDefinition>
  namespaces: Map<string, Tool.Namespace>
  errors: { kind: "tool" | "namespace"; name: string; namespace?: string; error: RegistrationError }[]
}

export interface Interface extends State.Transformable<Editor> {
  readonly list: () => Effect.Effect<ReadonlyArray<Tool.Info & { readonly id: string }>>
  readonly snapshot: (permissions?: Permission.Ruleset) => Effect.Effect<Snapshot>
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
    const ambientJobs = Option.getOrUndefined(yield* Effect.serviceOption(Job.Service))
    const ambientToolOutput = Option.getOrUndefined(yield* Effect.serviceOption(ToolOutput.Service))

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

    const beforeExecute = (name: string, input: unknown, context: Tool.Context) =>
      hooks.trigger("tool", "execute.before", {
        tool: name,
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
      context: Tool.Context,
    ) {
      const execution = yield* execute(tool, input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
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

    const executeTopLevel = Effect.fnUntraced(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const jobs = Option.getOrUndefined(yield* Effect.serviceOption(Job.Service)) ?? ambientJobs
      if (!jobs || tool.options?.background === false) return yield* executeTool(tool, name, input, context)

      const toolOutput = Option.getOrUndefined(yield* Effect.serviceOption(ToolOutput.Service)) ?? ambientToolOutput
      const forms = Option.getOrUndefined(yield* Effect.serviceOption(Form.Service))
      const callContext = yield* Effect.context<never>()
      const yielded = yield* Ref.make(false)
      const latestProgress = yield* Ref.make<Tool.Metadata>({})
      const wrappedContext: Tool.Context = {
        ...context,
        progress: (update) =>
          Effect.gen(function* () {
            yield* Ref.update(latestProgress, (prev) => ({ ...prev, ...update }))
            if (!(yield* Ref.get(yielded))) yield* context.progress(update)
          }),
      }

      const id = `job_${Identifier.create(false)}`
      const title = toolJobTitle(name, input)
      let caughtFailure: Tool.Error | undefined
      let caughtDefect: Cause.Cause<never> | undefined

      const outcome = yield* jobs
        .start<NormalizedResult>({
          id,
          sessionID: context.sessionID,
          type: name,
          title: title ?? name,
          metadata: { sessionID: context.sessionID, callID: context.id },
          recovery: { kind: "tool", sessionID: context.sessionID, tool: name, ...(title ? { title } : {}) },
          output: Ref.get(latestProgress).pipe(Effect.map(formatProgress)),
          run: executeTool(tool, name, input, wrappedContext).pipe(
            Effect.provide(callContext),
            Effect.flatMap((raw) =>
              Effect.gen(function* () {
                const value = toolOutput ? yield* toolOutput.truncate(raw) : raw
                return { output: yield* renderResultText(value, toolOutput), value }
              }),
            ),
            Effect.tapCause((cause) =>
              Effect.sync(() => {
                const err = Option.getOrUndefined(Cause.findErrorOption(cause))
                if (err instanceof Tool.Error) caughtFailure = err
                else if (!Cause.hasInterruptsOnly(cause)) caughtDefect = cause as Cause.Cause<never>
              }),
            ),
          ),
        })
        .pipe(
          Effect.andThen(
            jobs.block<NormalizedResult>({
              id,
              sessionID: context.sessionID,
              yield_after: requestedYieldAfter(input) ?? Job.DEFAULT_YIELD_AFTER_MS,
              deferYield: Effect.gen(function* () {
                if ((yield* permission.forSession(context.sessionID)).length > 0) return true
                return forms
                  ? (yield* forms.list()).some((item) => item.sessionID === undefined || item.sessionID === context.sessionID)
                  : false
              }).pipe(Effect.catchCause(() => Effect.succeed(false))),
            }),
          ),
          Effect.onInterrupt(() => jobs.cancel(id, { notify: false }).pipe(Effect.ignore)),
        )

      if (outcome?.type === "backgrounded") {
        yield* Ref.set(yielded, true)
        const progressMeta = yield* Ref.get(latestProgress)
        const partial = formatProgress(progressMeta)
        const label = name === "execute" ? "Code Mode execution" : `Tool "${name}"`
        const text = [
          `${label} moved to the background (jobID: ${id}).`,
          ...(partial ? [`Output so far:\n${partial}`] : []),
          BACKGROUND_TOOL_INSTRUCTION,
        ].join("\n\n")
        const toolCalls = Array.isArray(progressMeta.toolCalls) ? progressMeta.toolCalls : []
        return {
          ...(name === "execute"
            ? { output: { output: text, toolCalls, files: [], status: "running" as const, jobID: id } }
            : {}),
          content: [{ type: "text" as const, text }],
          metadata: { ...(toolCalls.length > 0 ? { toolCalls } : {}), status: "running", jobID: id },
        }
      }

      if (caughtDefect) return yield* Effect.failCause(caughtDefect)
      if (caughtFailure) return yield* caughtFailure
      if (outcome?.info.status === "cancelled") return yield* new Tool.Error({ message: "Tool execution cancelled" })
      if (outcome?.info.status === "error")
        return yield* new Tool.Error({ message: outcome.info.error ?? `Tool "${name}" failed` })
      if (!outcome?.info.value) return yield* new Tool.Error({ message: `Tool "${name}" failed` })
      return outcome.info.value
    })

    let catalog:
      | {
          data: Data
          names: string
          inventory: CodeModeTool.Inventory
          value: CodeModeCatalog.Inventory
          definition: ToolDefinition
        }
      | undefined
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
          const registered = register(tool)
          if (Result.isFailure(registered)) {
            editor.errors.push({
              kind: "tool",
              name: tool.name,
              namespace: tool.options?.namespace,
              error: registered.failure,
            })
            return
          }
          const id = effectiveName(tool)
          editor.tools.set(id, { ...tool, id, options: tool.options && { ...tool.options } })
          editor.definitions.set(id, registered.success)
        },
        update: (id, update) => {
          const current = editor.tools.get(id)
          if (!current) return
          const tool = { ...current, options: current.options && { ...current.options } }
          update(tool)
          tool.name = current.name
          tool.id = id
          if (tool.options?.namespace !== current.options?.namespace)
            tool.options = { ...tool.options, namespace: current.options?.namespace }
          const registered = register(tool)
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
        },
        remove: (id) => {
          editor.tools.delete(id)
          editor.definitions.delete(id)
        },
      }),
      notify: (value) => {
        catalog = undefined
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
      list: () => Effect.sync(() => Array.from(state.get().tools.values())),
      snapshot: Effect.fn("Tool.snapshot")((permissions) =>
        Effect.sync(() => {
          const data = state.get()
          const active = new Map<string, Tool.Info>()
          const rules = permissions ?? []
          for (const [name, tool] of data.tools) {
            if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
            active.set(name, tool)
          }
          const codeModeEnabled = !whollyDisabled("execute", rules)
          // Without Code Mode its tools would be unreachable, so expose them as direct tools instead.
          const direct = codeModeEnabled
            ? new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
            : active
          const codeModeTools = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false))
          const names = Array.from(codeModeTools.keys()).join("\0")
          // Discovery is immutable for a registry revision and visible tool set. Keep executors
          // fresh, but share the inventory, whose prepared runtime and much larger rendered catalog
          // are cached by identity, and the execute tool's definition across steps.
          const cached = catalog?.data === data && catalog.names === names ? catalog : undefined
          const codeModeInventory = cached?.inventory ?? { tools: codeModeTools, namespaces: data.namespaces }
          const codeModeTool = codeModeEnabled
            ? CodeModeTool.create(
                codeModeInventory,
                (name, tool, input, context) =>
                  beforeExecute(name, input, context).pipe(
                    Effect.flatMap((event) => executeTool(tool, name, event.input, context)),
                  ),
                permission,
              )
            : undefined
          const codeModeCatalog = !codeModeEnabled
            ? undefined
            : (cached?.value ?? CodeModeTool.catalog(codeModeInventory))
          const codeModeDefinition = codeModeTool && (cached?.definition ?? definition(codeModeTool))
          if (codeModeCatalog && codeModeDefinition)
            catalog = {
              data,
              names,
              inventory: codeModeInventory,
              value: codeModeCatalog,
              definition: codeModeDefinition,
            }
          return {
            ...(codeModeCatalog === undefined ? {} : { codeModeCatalog }),
            definitions: [
              ...Array.from(direct)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([name]) => data.definitions.get(name)!),
              ...(codeModeDefinition ? [codeModeDefinition] : []),
            ],
            execute: Effect.fnUntraced(function* (input: Parameters<Snapshot["execute"]>[0]) {
              const context: Tool.Context = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
              }
              const event = yield* beforeExecute(input.call.name, input.call.input, context)
              const requested = input.definitions?.get(event.tool)
              // Preserve session context removal and alias resolution, now after the repair hook.
              if (!requested && input.definitions && (direct.has(event.tool) || codeModeTool?.name === event.tool))
                return yield* new Tool.Error({ message: `Tool is not available for this request: ${event.tool}` })
              const name = requested?.name ?? event.tool
              if (name === "execute" && codeModeTool)
                return yield* executeTopLevel(codeModeTool, name, event.input, context)
              const tool = direct.get(name)
              if (tool) return yield* executeTopLevel(tool, name, event.input, context)
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
        const tools = new Map(
          Array.from(data.tools).filter(
            ([name, tool]) =>
              tool.options?.codemode !== false &&
              allowed.has(CodeModeTool.qualifiedName(tool)) &&
              !whollyDisabled(tool.options?.permission ?? name, input.permissions),
          ),
        )
        const callSeq = yield* Ref.make(0)
        return yield* CodeModeTool.check(
          { tools, namespaces: data.namespaces },
          input.code,
          input.bindings,
          input.limits,
          (name, tool, toolInput) =>
            Effect.gen(function* () {
              const index = yield* Ref.getAndUpdate(callSeq, (value) => value + 1)
              const context: Tool.Context = {
                ...input.context,
                id: Tool.CallID.make(`call_${input.context.messageID}_${index}`),
              }
              const event = yield* beforeExecute(name, toolInput, context)
              return yield* executeTool(tool, name, event.input, context)
            }),
        )
      }),
    })
  }),
)

function requestedYieldAfter(input: unknown): number | undefined {
  if (!isRecord(input)) return undefined
  if (input.background === true) return 0
  if (typeof input.yield_after === "number" && Number.isFinite(input.yield_after) && input.yield_after >= 0)
    return Math.floor(input.yield_after)
  return undefined
}

function toolJobTitle(name: string, input: unknown): string | undefined {
  if (!isRecord(input)) return undefined
  if (name === "execute" && typeof input.code === "string") {
    return input.code
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0)
      ?.slice(0, 80)
  }
  for (const key of ["title", "description", "url", "query", "command"]) {
    const val = input[key]
    if (typeof val === "string" && val.trim().length > 0) return val.trim().slice(0, 80)
  }
  return undefined
}

function formatProgress(meta: Tool.Metadata): string | undefined {
  const parts: string[] = []
  if (typeof meta.title === "string" && meta.title.length > 0) parts.push(meta.title)
  if (Array.isArray(meta.logs) && meta.logs.length > 0) {
    parts.push(`Logs:\n${meta.logs.filter((item): item is string => typeof item === "string").join("\n")}`)
  }
  if (Array.isArray(meta.toolCalls) && meta.toolCalls.length > 0) {
    const lines = meta.toolCalls.flatMap((call) =>
      isRecord(call) && typeof call.tool === "string" && typeof call.status === "string"
        ? [`- [${call.status}] ${call.tool}`]
        : [],
    )
    if (lines.length > 0) parts.push(`Tool calls:\n${lines.join("\n")}`)
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined
}

const renderResultText = Effect.fnUntraced(function* (result: NormalizedResult, toolOutput?: ToolOutput.Interface) {
  const parts: string[] = []
  for (const part of result.content) {
    if (part.type === "text") {
      if (part.text.length > 0) parts.push(part.text)
      continue
    }
    const base64 = /^data:([^,;]*)(?:;[^,]*)?;base64,(.*)$/s.exec(part.uri)
    if (base64 && toolOutput) {
      const ext = extension((base64[1] || part.mime).toLowerCase())
      const file = yield* toolOutput.save(Buffer.from(base64[2], "base64"), ext ? `.${ext}` : "")
      parts.push(`Saved file${part.name ? ` (${part.name})` : ""}: ${file} (${part.mime}). Use the read tool on this path to view it.`)
    } else {
      parts.push(`[Attachment ${part.name ?? part.uri} (${part.mime})]`)
    }
  }
  if (parts.length > 0) return parts.join("\n\n")
  if (result.output !== undefined) return typeof result.output === "string" ? result.output : JSON.stringify(result.output)
  return ""
})

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function register(tool: Tool.Info): Result.Result<ToolDefinition, RegistrationError> {
  const namespace = tool.options?.namespace
  if (namespace !== undefined) {
    const error = namespaceError(namespace)
    if (error) return Result.fail(error)
  }
  const name = normalizedName(tool)
  if (!/^[A-Za-z0-9_-]+$/.test(name))
    return Result.fail(new RegistrationError({ name, message: `Invalid tool name: ${name}` }))
  const id = effectiveName(tool)
  if (tool.options?.codemode === false && id === "execute")
    return Result.fail(new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' }))
  return Result.try({
    try: () => ToolDefinition.make(definition(tool)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
}

function namespaceError(name: string) {
  if (name.split(".").every((segment) => /^[A-Za-z0-9_-]+$/.test(segment))) return
  return new RegistrationError({ name, message: `Invalid tool namespace: ${JSON.stringify(name)}` })
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node, Permission.node],
})
