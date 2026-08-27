export * as Tool from "./tool.js"
export { CallID, Content, Error, FileContent, TextContent } from "@opencode-ai/schema/tool"
export type { Context, Metadata, Options, Result } from "@opencode-ai/schema/tool"

import { ToolDefinition, type ToolCall } from "@opencode-ai/ai"
import { Tool } from "@opencode-ai/schema/tool"
import { Context, Effect, Layer, Result, Schema, SchemaIssue, Types } from "effect"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import type { Agent } from "./agent.js"
import { CodeModeCatalog } from "./codemode/catalog.js"
import { CodeModeTool } from "./codemode/tool.js"
import { Image } from "./image.js"
import { Permission } from "./permission.js"
import { PluginHooks } from "./plugin/hooks.js"
import { SessionMessage } from "./session/message.js"
import { SessionSchema } from "./session/schema.js"
import { State } from "./state.js"
import { definition, execute, normalizeContent } from "./tool/runtime.js"
import { Wildcard } from "./util/wildcard.js"

export class RegistrationError extends Schema.TaggedError<RegistrationError>()("Tool.RegistrationError", {
  name: Schema.String,
  message: Schema.String,
}) {}

export interface Draft {
  readonly add: (tool: Tool.Info) => void
  readonly update: (id: string, update: (tool: Types.Mutable<Tool.Info>) => void) => void
  readonly remove: (id: string) => void
}

type Data = {
  tools: Map<string, Tool.Info>
  errors: { tool: Tool.Info; error: RegistrationError }[]
}

export interface Interface extends State.Transformable<Draft> {
  readonly snapshot: (permissions?: Permission.Ruleset) => Effect.Effect<Snapshot>
}

export interface Snapshot {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeCatalog?: ReadonlyArray<CodeModeCatalog.Entry>
  readonly execute: (input: {
    readonly sessionID: SessionSchema.ID
    readonly agent: Agent.ID
    readonly messageID: SessionMessage.ID
    readonly call: ToolCall
    readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
  }) => Effect.Effect<Tool.Result & { readonly content: ReadonlyArray<Tool.Content> }, Tool.Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Tool") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hooks = yield* PluginHooks.Service
    const image = yield* Image.Service

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

    const executeTool = Effect.fn("Tool.execute")(function* (
      tool: Tool.Info,
      name: string,
      input: unknown,
      context: Tool.Context,
    ) {
      const beforeEvent: PluginHooks.Domains["tool"]["execute.before"] = {
        tool: name,
        inputSchema: definition(tool).inputSchema,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input,
      }
      yield* hooks.trigger("tool", "execute.before", beforeEvent)
      const execution = yield* execute(tool, beforeEvent.input, context).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("Tool.Error", (failure) => Effect.succeed({ failure })),
      )
      const base = {
        tool: name,
        sessionID: context.sessionID,
        agent: context.agent,
        messageID: context.messageID,
        id: context.id,
        input: beforeEvent.input,
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

    const state: State.Interface<Data, Draft> = State.create<Data, Draft>({
      name: "tool",
      initial: () => ({
        tools: new Map(),
        errors: [],
      }),
      draft: (draft) => ({
        add: (tool) => {
          const error = registrationError(tool)
          if (error) {
            draft.errors.push({ tool, error })
            return
          }
          draft.tools.set(effectiveName(tool), { ...tool, options: tool.options && { ...tool.options } })
        },
        update: (id, update) => {
          const current = draft.tools.get(id)
          if (!current) return
          const tool = { ...current, options: current.options && { ...current.options } }
          update(tool)
          tool.name = current.name
          if (tool.options?.namespace !== current.options?.namespace)
            tool.options = { ...tool.options, namespace: current.options?.namespace }
          const error = registrationError(tool)
          if (error) {
            draft.errors.push({ tool, error })
            return
          }
          draft.tools.set(id, tool)
        },
        remove: (id) => {
          draft.tools.delete(id)
        },
      }),
      finalize: () =>
        Effect.forEach(
          state.get().errors,
          ({ tool, error }) =>
            Effect.logError("Skipping invalid tool registration", {
              name: tool.name,
              namespace: tool.options?.namespace,
              error: error.message,
            }),
          { discard: true },
        ),
    })

    return Service.of({
      transform: state.transform,
      reload: state.reload,
      snapshot: Effect.fn("Tool.snapshot")((permissions) =>
        Effect.sync(() => {
          const active = new Map<string, Tool.Info>()
          const rules = permissions ?? []
          for (const [name, tool] of state.get().tools) {
            if (whollyDisabled(tool.options?.permission ?? name, rules)) continue
            active.set(name, tool)
          }
          const direct = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode === false))
          const codemode = new Map(Array.from(active).filter(([, tool]) => tool.options?.codemode !== false))
          const executeRule = rules.findLast((rule) => Wildcard.match("execute", rule.action))
          const codemodeEnabled = executeRule?.resource !== "*" || executeRule.effect !== "deny"
          const codemodeTool = codemodeEnabled
            ? CodeModeTool.create(codemode, (name, tool, input, context) => executeTool(tool, name, input, context))
            : undefined
          const codeModeCatalog = codemodeEnabled ? CodeModeTool.catalog(codemode) : undefined
          return {
            ...(codeModeCatalog === undefined ? {} : { codeModeCatalog }),
            definitions: [
              ...Array.from(direct)
                .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                .map(([, tool]) => definition(tool)),
              ...(codemodeTool ? [definition(codemodeTool)] : []),
            ],
            execute: (input: {
              readonly sessionID: SessionSchema.ID
              readonly agent: Agent.ID
              readonly messageID: SessionMessage.ID
              readonly call: ToolCall
              readonly progress?: (update: Tool.Metadata) => Effect.Effect<void>
            }) => {
              const context: Tool.Context = {
                sessionID: input.sessionID,
                agent: input.agent,
                messageID: input.messageID,
                id: Tool.CallID.make(input.call.id),
                progress: input.progress ?? (() => Effect.void),
              }
              if (input.call.name === "execute" && codemodeTool)
                return executeTool(codemodeTool, input.call.name, input.call.input, context)
              const tool = direct.get(input.call.name)
              if (tool) return executeTool(tool, input.call.name, input.call.input, context)
              return new Tool.Error({ message: `Unknown tool: ${input.call.name}` })
            },
          }
        }),
      ),
    })
  }),
)

const whollyDisabled = (action: string, rules: Permission.Ruleset) => {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

const formatSchemaIssue = SchemaIssue.makeFormatterDefault()

function schemaMakeError(error: unknown) {
  if (error instanceof Error && SchemaIssue.isIssue(error.cause)) return formatSchemaIssue(error.cause)
  return error instanceof Error ? error.message : String(error)
}

function registrationError(tool: Tool.Info) {
  const namespace = tool.options?.namespace
  if (namespace !== undefined && !namespace.split(".").every((segment) => /^[A-Za-z0-9_-]{1,64}$/.test(segment)))
    return new RegistrationError({ name: namespace, message: `Invalid tool namespace: ${JSON.stringify(namespace)}` })
  const name = normalizedName(tool)
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) return new RegistrationError({ name, message: `Invalid tool name: ${name}` })
  const id = effectiveName(tool)
  if (tool.options?.codemode === false && id === "execute")
    return new RegistrationError({ name: id, message: 'Tool name "execute" is reserved for CodeMode' })
  const result = Result.try({
    try: () => ToolDefinition.make(definition(tool)),
    catch: (error) =>
      new RegistrationError({ name: id, message: `Invalid tool definition ${id}: ${schemaMakeError(error)}` }),
  })
  return Result.isFailure(result) ? result.failure : undefined
}

const normalizedName = (tool: Tool.Info) => tool.name.replace(/[^a-zA-Z0-9_-]/g, "_")

const effectiveName = (tool: Tool.Info) =>
  tool.options?.namespace === undefined
    ? normalizedName(tool)
    : `${tool.options.namespace.replaceAll(".", "_")}_${normalizedName(tool)}`

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [PluginHooks.node, Image.node],
})
