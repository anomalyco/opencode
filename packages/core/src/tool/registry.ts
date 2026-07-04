export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import type { AgentV2 } from "../agent"
import { Flag } from "../flag/flag"
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

export type ExecuteInput = {
  readonly sessionID: SessionSchema.ID
  readonly agent: AgentV2.ID
  readonly assistantMessageID: SessionMessage.ID
  readonly call: ToolCall
}

export interface Interface {
  readonly materialize: (input: MaterializeInput) => Effect.Effect<Materialization>
  /** Internal registration capability exposed publicly only through Tools.Service. */
  readonly register: (
    tools: Readonly<Record<string, AnyTool>>,
    options?: Tools.RegisterOptions,
  ) => Effect.Effect<void, RegistrationError, Scope.Scope>
}

export interface MaterializeInput {
  readonly model: { readonly id: string; readonly provider: string }
  readonly permissions?: PermissionV2.Ruleset
}

export interface Materialization {
  readonly definitions: ReadonlyArray<ToolDefinition>
  readonly settle: (input: ExecuteInput) => Effect.Effect<Settlement, ToolOutputStore.Error>
}

export interface Settlement {
  readonly result: ToolResultValue
  readonly output?: ToolOutput
  readonly outputPaths?: ReadonlyArray<string>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/ToolRegistry") {}

const registryLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const resources = yield* ToolOutputStore.Service
    const toolHooks = yield* ToolHooks.Service
    type Registration = {
      readonly identity: object
      readonly tool: AnyTool
      readonly name: string
      readonly group?: string
      readonly deferred: boolean
    }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleTool = Effect.fn("ToolRegistry.settleTool")(function* (input: ExecuteInput, tool: AnyTool) {
      // Hooks fire only for hosted/local tools; provider-executed calls never reach settleTool.
      const beforeEvent: ToolHooks.BeforeEvent = {
        tool: input.call.name,
        sessionID: input.sessionID,
        agent: input.agent,
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
        input: input.call.input,
      }
      yield* toolHooks.runBefore(beforeEvent)
      const pending = yield* settle(
        tool,
        { ...input.call, input: beforeEvent.input },
        {
          sessionID: input.sessionID,
          agent: input.agent,
          assistantMessageID: input.assistantMessageID,
          toolCallID: input.call.id,
        },
      ).pipe(
        Effect.map((output) => ({ output })),
        Effect.catchTag("LLM.ToolFailure", (failure) =>
          Effect.succeed({ result: { type: "error" as const, value: failure.message } }),
        ),
      )
      let settlement: Settlement
      if ("result" in pending) {
        settlement = pending
      } else {
        const bounded = yield* resources.bound({
          sessionID: input.sessionID,
          toolCallID: input.call.id,
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
        assistantMessageID: input.assistantMessageID,
        toolCallID: input.call.id,
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
      }
    })

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, advertised: object) {
      const registration = local.get(input.call.name)?.at(-1)?.registration
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: `Stale tool call: ${input.call.name}`,
          },
        }
      if (registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      return yield* settleTool(input, registration.tool)
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools, options) {
        const entries = registrationEntries(tools, options?.group)
        if (entries.length === 0) return
        const reserved = options?.deferred ? undefined : entries.find((entry) => entry.key === "execute")
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
                    identity: {},
                    tool: entry.tool,
                    name: entry.name,
                    group: entry.group,
                    deferred: options?.deferred ?? false,
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
      materialize: Effect.fn("ToolRegistry.materialize")(function* (input) {
        const registrations = new Map<string, Registration>()
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        // OpenAI/GPT models use apply_patch; every other model uses edit and write.
        const usePatch = input.model.provider.toLowerCase() === "openai" || input.model.id.toLowerCase().includes("gpt")
        for (const [name, registration] of registrations) {
          const wrongEditTool = name === "apply_patch" ? !usePatch : (name === "edit" || name === "write") && usePatch
          if (
            wrongEditTool ||
            (registration.deferred && !Flag.CODEMODE_ENABLED) ||
            whollyDisabled(permission(registration.tool, name), input.permissions ?? [])
          )
            registrations.delete(name)
        }
        const direct = new Map(Array.from(registrations).filter(([, registration]) => !registration.deferred))
        const deferred = new Map(Array.from(registrations).filter(([, registration]) => registration.deferred))
        const execute =
          deferred.size > 0 && !whollyDisabled("execute", input.permissions ?? [])
            ? ExecuteTool.create({
                registrations: deferred,
                current: (name) => local.get(name)?.at(-1)?.registration,
              })
            : undefined
        return {
          definitions: [
            ...Array.from(direct, ([name, registration]) => definition(name, registration.tool)),
            ...(execute ? [definition("execute", execute)] : []),
          ],
          settle: (input) => {
            if (input.call.name === "execute" && execute) return settleTool(input, execute)
            const registration = direct.get(input.call.name)
            if (registration) return settleWith(input, registration.identity)
            return Effect.succeed({ result: { type: "error", value: `Unknown tool: ${input.call.name}` } })
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
