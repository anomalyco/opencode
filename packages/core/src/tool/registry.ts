export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import type { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { ExecuteTool } from "./execute"
import { definition, permission, registrationEntries, RegistrationError, settle, type AnyTool } from "./tool"
import { Tools } from "./tools"
import { ToolHooks } from "./hooks"
import { makeLocationNode } from "../effect/app-node"
import { SessionError } from "@opencode-ai/schema/session-error"
import { toSessionError } from "../session/to-session-error"

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly messageID: SessionMessage.ID
  readonly call: ToolCall
  readonly progress?: (update: Progress) => Effect.Effect<void>
}

export interface Progress {
  readonly structured: Readonly<Record<string, unknown>>
  readonly content: ToolOutput["content"]
}

export interface Interface {
  readonly materialize: (permissions?: PermissionV2.Ruleset) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (
    tools: Readonly<Record<string, AnyTool>>,
    options?: Tools.RegisterOptions,
  ) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
  readonly error?: SessionError.Error
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resources = yield* ToolOutputStore.Service
    const toolHooks = yield* ToolHooks.Service
    type Registration = {
      readonly tool: AnyTool
      readonly name: string
      readonly group?: string
      readonly codemode: boolean
    }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleTool = Effect.fn("ToolRegistry.settleTool")(function* (input: ExecuteInput, tool: AnyTool) {
      // Hooks fire only for hosted/local tools; provider-executed calls never reach settleTool.
      const beforeEvent: ToolHooks.BeforeEvent = {
        tool: input.call.name,
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        callID: input.call.id,
        input: input.call.input,
      }
      yield* toolHooks.runBefore(beforeEvent)
      const pending = yield* settle(
        tool,
        { ...input.call, input: beforeEvent.input },
        {
          sessionID: input.sessionID,
          agent: input.agent,
          messageID: input.messageID,
          callID: input.call.id,
          progress: (update) =>
            input.progress?.({
              structured: update.structured,
              content: (update.content ?? []).map((part) =>
                part.type === "text"
                  ? { type: "text" as const, text: part.text }
                  : {
                      type: "file" as const,
                      uri: `data:${part.mime};base64,${part.data}`,
                      mime: part.mime,
                      name: part.name,
                    },
              ),
            }) ?? Effect.void,
        },
      ).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({
            result: { type: "error" as const, value: failure.message },
            error: toSessionError(failure),
          }),
        ),
      )
      let settlement: Settlement
      if ("result" in pending) {
        settlement = pending
      } else {
        const bounded = yield* resources.bound({
          sessionID: input.sessionID,
          callID: input.call.id,
          output: pending.output,
        })
        const result = ToolOutput.toResultValue(bounded.output)
        settlement =
          result.type === "error"
            ? bounded.outputPaths.length > 0
              ? { result, outputPaths: bounded.outputPaths }
              : { result }
            : bounded.outputPaths.length > 0
              ? { result, output: bounded.output, outputPaths: bounded.outputPaths }
              : { result, output: bounded.output }
      }
      const afterEvent: ToolHooks.AfterEvent = {
        tool: input.call.name,
        sessionID: input.sessionID,
        agent: input.agent,
        messageID: input.messageID,
        callID: input.call.id,
        input: beforeEvent.input,
        result: settlement.result,
        output: settlement.output,
        outputPaths: settlement.outputPaths,
      }
      yield* toolHooks.runAfter(afterEvent)
      return {
        result: afterEvent.result,
        ...(afterEvent.output !== undefined ? { output: afterEvent.output } : {}),
        ...(afterEvent.outputPaths !== undefined ? { outputPaths: afterEvent.outputPaths } : {}),
        ...(settlement.error !== undefined ? { error: settlement.error } : {}),
      }
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools, options) {
        const entries = registrationEntries(tools, options?.group)
        if (entries.length === 0) return
        const codemode = options?.codemode ?? true
        const reserved = codemode ? undefined : entries.find((entry) => entry.key === "execute")
        if (reserved)
          return yield* Effect.fail(
            new RegistrationError({ name: reserved.key, message: 'Tool name "execute" is reserved for CodeMode' }),
          )
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const entry of entries)
              local.set(entry.key, [
                ...(local.get(entry.key) ?? []),
                {
                  token,
                  registration: {
                    tool: entry.tool,
                    name: entry.name,
                    group: entry.group,
                    codemode,
                  },
                },
              ])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const entry of entries) {
                  const registrations =
                    local.get(entry.key)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(entry.key, registrations)
                  else local.delete(entry.key)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (permissions) {
        const direct = new Map<string, Registration>()
        const codemode = new Map<string, Registration>()
        const rules = permissions ?? []
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (!registration) continue
          if (whollyDisabled(permission(registration.tool, name), rules)) continue
          if (registration.codemode) codemode.set(name, registration)
          else direct.set(name, registration)
        }
        const execute =
          codemode.size > 0 && !whollyDisabled("execute", rules) ? ExecuteTool.create(codemode) : undefined
        return {
          definitions: [
            ...Array.from(direct, ([name, registration]) => definition(name, registration.tool)),
            ...(execute ? [definition("execute", execute)] : []),
          ],
          settle: (input) => {
            if (input.call.name === "execute" && execute) return settleTool(input, execute)
            const registration = direct.get(input.call.name)
            if (registration) return settleTool(input, registration.tool)
            return Effect.succeed({
              result: { type: "error", value: `Unknown tool: ${input.call.name}` },
              error: { type: "tool.unknown", message: `Unknown tool: ${input.call.name}` },
            })
          },
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) => Effect.succeed(Tools.Service.of({ register: registry.register }))),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [ToolOutputStore.node, ToolHooks.node],
})

export const toolsNode = makeLocationNode({
  service: Tools.Service,
  layer,
  deps: [ToolOutputStore.node, ToolHooks.node],
})
