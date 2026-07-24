export * as ToolRegistry from "./registry"

import { type ToolCall, type ToolContent, type ToolDefinition } from "@opencode-ai/ai"
import { Context, Effect, Layer, Schema, Scope, Semaphore } from "effect"
import type { AgentV2 } from "../agent"
import { Image } from "../image"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { CodeMode } from "../codemode"
import { Tool, nonEmpty, registrationEntries, toLLMDefinition, validateName, validateNamespace } from "./tool"
import { Tools } from "./tools"
import { ToolHooks } from "./hooks"
import { makeLocationNode } from "@opencode-ai/util/effect/app-node"
import { toSessionError } from "../session/to-session-error"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly messageID: SessionMessage.ID
  readonly call: ToolCall
  readonly progress?: (update: Progress) => Effect.Effect<void>
}

/** Live replacement metadata for a running tool. */
export type Progress = Tool.Metadata

export interface Interface {
  readonly snapshot: (permissions?: PermissionV2.Ruleset) => Effect.Effect<ToolSet>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (
    tools: Readonly<Record<string, Tool.Any>>,
    options?: Tools.RegisterOptions,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
  /** Internal atomic registration capability used by plugin transforms. */
  readonly registerBatch: (
    registrations: ReadonlyArray<{
      readonly tools: Readonly<Record<string, Tool.Any>>
      readonly options?: Tools.RegisterOptions
    }>,
  ) => Effect.Effect<void, Tool.RegistrationError, Scope.Scope>
}

/**
 * One request-scoped snapshot pairing Code Mode instructions and advertised
 * definitions with captured tools. A model request executes exactly the tool
 * values it advertised even if registration changes while it is in flight.
 */
export interface ToolSet {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly codeModeInstructions?: string
  readonly execute: (input: ExecuteInput) => Effect.Effect<ToolOutcome, ToolOutputStore.Error>
}

/**
 * The canonical outcome of one local tool execution. `output` is the validated
 * machine value for Code Mode and remains ephemeral; durable publication drops it.
 */
export type ToolOutcome =
  | (Extract<Tool.Outcome, { readonly status: "completed" }> & { readonly output?: unknown })
  | Extract<Tool.Outcome, { readonly status: "error" }>

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resources = yield* ToolOutputStore.Service
    const toolHooks = yield* ToolHooks.Service
    const image = yield* Image.Service
    const codeMode = yield* CodeMode.Service

    type NormalizedItem = ToolContent | "decode" | "size"
    const normalizeImages = Effect.fn("ToolRegistry.normalizeImages")(function* (content: ReadonlyArray<ToolContent>) {
      const normalized = yield* Effect.forEach(content, (item): Effect.Effect<NormalizedItem> => {
        if (item.type !== "file" || !item.mime.startsWith("image/")) return Effect.succeed(item)
        // RFC 2397 permits parameters between the mime and ";base64".
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

    // Invalid or oversized metadata is dropped with a warning; it never fails a
    // successful side-effecting tool.
    const validMetadata = Effect.fnUntraced(function* (tool: string, metadata: Tool.Metadata | undefined) {
      if (metadata === undefined) return undefined
      const limits = yield* resources.limits()
      const valid = Tool.jsonMetadata(metadata, limits.maxBytes)
      if (valid === undefined)
        yield* Effect.logWarning("dropping invalid or oversized tool metadata").pipe(Effect.annotateLogs({ tool }))
      return valid
    })

    type Registration = Tool.Registration
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()
    const registrationLock = Semaphore.makeUnsafe(1)

    const executeTool = Effect.fn("ToolRegistry.executeTool")(function* (input: ExecuteInput, tool: Tool.Any) {
      // Hooks fire only for hosted/local tools; provider-executed calls never reach executeTool.
      const beforeEvent: ToolHooks.BeforeEvent = {
        tool: input.call.name,
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        callID: input.call.id,
        input: input.call.input,
      }
      yield* toolHooks.runBefore(beforeEvent)
      const execution = yield* Tool.execute(tool, beforeEvent.input, {
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        callID: input.call.id,
        progress: (metadata) => {
          const progress = input.progress
          if (!progress) return Effect.void
          return validMetadata(input.call.name, metadata).pipe(
            Effect.flatMap((valid) => (valid === undefined ? Effect.void : progress(valid))),
          )
        },
      }).pipe(
        Effect.map((value) => ({ value })),
        Effect.catchTag("LLM.ToolFailure", (failure) => Effect.succeed({ failure: toSessionError(failure) })),
      )

      const outcome: ToolOutcome = yield* Effect.gen(function* () {
        if ("failure" in execution) return { status: "error" as const, error: execution.failure }
        const bounded = yield* resources.bound({
          sessionID: input.sessionID,
          callID: input.call.id,
          content: yield* normalizeImages(execution.value.content),
        })
        const metadata = yield* validMetadata(input.call.name, execution.value.metadata)
        return {
          status: "completed" as const,
          ...(execution.value.output === undefined ? {} : { output: execution.value.output }),
          content: nonEmpty(bounded.content) ?? execution.value.content,
          ...(metadata === undefined ? {} : { metadata }),
          ...(bounded.outputPaths.length > 0 ? { outputPaths: bounded.outputPaths } : {}),
        }
      })

      const base = {
        tool: input.call.name,
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        callID: input.call.id,
        input: beforeEvent.input,
      }
      const afterEvent: ToolHooks.AfterEvent =
        outcome.status === "completed"
          ? {
              ...base,
              status: "completed",
              content: outcome.content,
              ...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
              ...(outcome.outputPaths === undefined ? {} : { outputPaths: outcome.outputPaths }),
            }
          : {
              ...base,
              status: "error",
              error: outcome.error,
              ...(outcome.content === undefined ? {} : { content: outcome.content }),
              ...(outcome.metadata === undefined ? {} : { metadata: outcome.metadata }),
              ...(outcome.outputPaths === undefined ? {} : { outputPaths: outcome.outputPaths }),
            }
      yield* toolHooks.runAfter(afterEvent)
      const afterMetadata = yield* validMetadata(input.call.name, afterEvent.metadata)
      const afterContent = yield* Effect.gen(function* () {
        if (
          afterEvent.content === undefined ||
          (outcome.status === "completed" && afterEvent.content === outcome.content)
        )
          return { content: afterEvent.content, outputPaths: afterEvent.outputPaths }
        const bounded = yield* resources.bound({
          sessionID: input.sessionID,
          callID: input.call.id,
          content: yield* normalizeImages(afterEvent.content),
        })
        return {
          content: nonEmpty(bounded.content),
          outputPaths:
            bounded.outputPaths.length === 0
              ? afterEvent.outputPaths
              : Array.from(new Set([...(afterEvent.outputPaths ?? []), ...bounded.outputPaths])),
        }
      })
      if (afterEvent.status === "completed")
        return {
          status: "completed" as const,
          ...(outcome.status === "completed" && outcome.output !== undefined ? { output: outcome.output } : {}),
          content: afterContent.content ?? afterEvent.content,
          ...(afterMetadata === undefined ? {} : { metadata: afterMetadata }),
          ...(afterContent.outputPaths === undefined ? {} : { outputPaths: afterContent.outputPaths }),
        }
      return {
        status: "error" as const,
        error: afterEvent.error,
        ...(afterContent.content === undefined ? {} : { content: afterContent.content }),
        ...(afterMetadata === undefined ? {} : { metadata: afterMetadata }),
        ...(afterContent.outputPaths === undefined ? {} : { outputPaths: afterContent.outputPaths }),
      }
    })

    const registerBatch: Interface["registerBatch"] = Effect.fn("ToolRegistry.registerBatch")(
      function* (registrations) {
        const planned = yield* Effect.forEach(registrations, ({ tools, options }) =>
          Effect.gen(function* () {
            if (options?.namespace !== undefined) yield* validateNamespace(options.namespace)
            const entries = registrationEntries(tools, options)
            yield* Effect.forEach(entries, (entry) => validateName(entry.name), { discard: true })
            const collision = entries.find(
              (entry, index) => entries.findIndex((candidate) => candidate.key === entry.key) !== index,
            )
            if (collision)
              return yield* Effect.fail(
                new Tool.RegistrationError({
                  name: collision.key,
                  message: `Duplicate normalized tool name: ${collision.key}`,
                }),
              )
            const codemode = options?.codemode ?? true
            const reserved = codemode ? undefined : entries.find((entry) => entry.key === "execute")
            if (reserved)
              return yield* Effect.fail(
                new Tool.RegistrationError({
                  name: reserved.key,
                  message: 'Tool name "execute" is reserved for CodeMode',
                }),
              )
            return { tools, options, entries, codemode }
          }),
        )
        // CodeMode registrations live in the CodeMode service; the registry keeps only direct tools.
        yield* Effect.forEach(
          planned.filter((plan) => plan.codemode && plan.entries.length > 0),
          (plan) => codeMode.register(plan.entries),
          { discard: true },
        )
        const direct = planned.filter((plan) => !plan.codemode)
        if (direct.every((plan) => plan.entries.length === 0)) return
        yield* Effect.uninterruptible(
          registrationLock.withPermit(
            Effect.gen(function* () {
              const token = {}
              for (const { entries } of direct)
                for (const entry of entries)
                  local.set(entry.key, [
                    ...(local.get(entry.key) ?? []),
                    {
                      token,
                      registration: {
                        tool: entry.tool,
                        name: entry.name,
                        namespace: entry.namespace,
                        permission: entry.permission,
                      },
                    },
                  ])
              yield* Effect.addFinalizer(() =>
                registrationLock.withPermit(
                  Effect.sync(() => {
                    for (const { entries } of direct)
                      for (const entry of entries) {
                        const registrations =
                          local.get(entry.key)?.filter((registration) => registration.token !== token) ?? []
                        if (registrations.length > 0) local.set(entry.key, registrations)
                        else local.delete(entry.key)
                      }
                  }),
                ),
              )
            }),
          ),
        )
      },
    )

    return Service.of({
      register: Effect.fn("ToolRegistry.register")((tools, options) =>
        registerBatch([
          {
            tools,
            ...(options === undefined ? {} : { options }),
          },
        ]),
      ),
      registerBatch,
      snapshot: Effect.fn("ToolRegistry.snapshot")((permissions) =>
        registrationLock.withPermit(
          Effect.gen(function* () {
            const direct = new Map<string, Registration>()
            const rules = permissions ?? []
            for (const [name, entries] of local) {
              const registration = entries.at(-1)?.registration
              if (!registration) continue
              if (whollyDisabled(registration.permission, rules)) continue
              direct.set(name, registration)
            }
            const codeModeMaterialization = yield* codeMode.materialize(permissions)
            const codemodeTool = codeModeMaterialization.tool
            return {
              ...(codeModeMaterialization.instructions === undefined
                ? {}
                : { codeModeInstructions: codeModeMaterialization.instructions }),
              definitions: [
                // Definitions are prompt-cache prefix bytes, so order only after effective registrations settle.
                ...Array.from(direct)
                  .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
                  .map(([name, registration]) => toLLMDefinition(name, registration.tool)),
                ...(codemodeTool ? [toLLMDefinition("execute", codemodeTool)] : []),
              ],
              execute: (input: ExecuteInput) => {
                if (input.call.name === "execute" && codemodeTool) return executeTool(input, codemodeTool)
                const registration = direct.get(input.call.name)
                if (registration) return executeTool(input, registration.tool)
                return Effect.succeed<ToolOutcome>({
                  status: "error",
                  error: { type: "tool.unknown", message: `Unknown tool: ${input.call.name}` },
                })
              },
            }
          }),
        ),
      ),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) =>
    Effect.succeed(Tools.Service.of({ register: registry.register, registerBatch: registry.registerBatch })),
  ),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [CodeMode.node, ToolOutputStore.node, ToolHooks.node, Image.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [CodeMode.node, ToolOutputStore.node, ToolHooks.node, Image.node],
})
