export * as ToolRegistry from "./registry"

import { ToolOutput, type ToolCall, type ToolDefinition, type ToolResultValue } from "@opencode-ai/llm"
import { Context, Effect, Layer, Scope } from "effect"
import type { AgentV2 } from "../agent"
import { PermissionV2 } from "../permission"
import { SessionMessage } from "../session/message"
import { SessionSchema } from "../session/schema"
import { ToolOutputStore } from "../tool-output-store"
import { Wildcard } from "../util/wildcard"
import { definition, permission, registrationEntries, settle, type AnyTool, type RegistrationError } from "./tool"
import { Tools, type ExecutePath, type RegisterOptions } from "./tools"
import { ToolHooks } from "./hooks"
import { makeLocationNode } from "../effect/app-node"
import { ExecuteTool } from "./execute"

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
    options?: RegisterOptions,
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
    type Registration = { readonly identity: object; readonly tool: AnyTool; readonly execute?: ExecutePath }
    const local = new Map<string, Array<{ readonly token: object; readonly registration: Registration }>>()

    const settleRegistration = Effect.fn("ToolRegistry.settleRegistration")(function* (
      input: ExecuteInput,
      registration: Registration,
    ) {
      // Hooks fire only for hosted/local tools; provider-executed calls never reach the registry.
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
        registration.tool,
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

    const settleLocal = Effect.fn("ToolRegistry.settleLocal")(function* (input: ExecuteInput, advertised?: object) {
      const registration = local.get(input.call.name)?.at(-1)?.registration
      if (!registration)
        return {
          result: {
            type: "error" as const,
            value: advertised ? `Stale tool call: ${input.call.name}` : `Unknown tool: ${input.call.name}`,
          },
        }
      if (advertised && registration.identity !== advertised)
        return { result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` } }
      return yield* settleRegistration(input, registration)
    })

    return Service.of({
      register: Effect.fn("ToolRegistry.register")(function* (tools, options) {
        const entries = registrationEntries(tools)
        if (entries.length === 0) return
        yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const token = {}
            for (const [name, tool] of entries)
              local.set(name, [
                ...(local.get(name) ?? []),
                { token, registration: { identity: {}, tool, execute: options?.execute?.[name] } },
              ])
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                for (const [name] of entries) {
                  const registrations = local.get(name)?.filter((registration) => registration.token !== token) ?? []
                  if (registrations.length > 0) local.set(name, registrations)
                  else local.delete(name)
                }
              }),
            )
          }),
        )
      }),
      materialize: Effect.fn("ToolRegistry.materialize")(function* (input) {
        const usePatch = input.model.provider.toLowerCase() === "openai" || input.model.id.toLowerCase().includes("gpt")
        const eligible = (name: string, registration: Registration) => {
          const wrongEditTool = name === "apply_patch" ? !usePatch : (name === "edit" || name === "write") && usePatch
          return !wrongEditTool && !whollyDisabled(permission(registration.tool, name), input.permissions ?? [])
        }
        const hasProjectedTools = () =>
          Array.from(local).some(([name, entries]) => {
            const registration = entries.at(-1)?.registration
            return registration?.execute !== undefined && eligible(name, registration)
          })
        const registrations = new Map<string, Registration>()
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        // OpenAI/GPT models use apply_patch; every other model uses edit and write.
        for (const [name, registration] of registrations) {
          if (!eligible(name, registration)) registrations.delete(name)
        }

        const children = Array.from(registrations).flatMap(([name, registration]) =>
          registration.execute ? [{ name, path: registration.execute, registration }] : [],
        )
        const executeItems: Record<string, Record<string, ExecuteTool.Item>> = Object.create(null)
        for (const child of children) {
          registrations.delete(child.name)
          const [namespace, member] = child.path
          executeItems[namespace] ??= Object.create(null)
          const info = definition(child.name, child.registration.tool)
          executeItems[namespace][member] = {
            description: info.description,
            input: info.inputSchema,
            output: info.outputSchema,
            invoke: (value, callID, context) =>
              settleLocal(
                {
                  sessionID: context.sessionID,
                  agent: context.agent,
                  assistantMessageID: context.assistantMessageID,
                  call: { type: "tool-call", id: callID, name: child.name, input: value },
                },
                child.registration.identity,
              ),
          }
        }
        const executeRegistration =
          children.length > 0 && !whollyDisabled("execute", input.permissions ?? [])
            ? { identity: {}, tool: ExecuteTool.makeTool(executeItems) }
            : undefined
        if (executeRegistration) registrations.set("execute", executeRegistration)

        return {
          definitions: Array.from(registrations, ([name, registration]) => definition(name, registration.tool)),
          settle: (input) => {
            const registration = registrations.get(input.call.name)
            if (executeRegistration && registration === executeRegistration) {
              if (
                children.some(
                  (child) => local.get(child.name)?.at(-1)?.registration.identity !== child.registration.identity,
                )
              )
                return Effect.succeed({ result: { type: "error" as const, value: "Stale tool call: execute" } })
              return settleRegistration(input, registration)
            }
            if (registration && input.call.name === "execute" && hasProjectedTools())
              return Effect.succeed({ result: { type: "error" as const, value: "Stale tool call: execute" } })
            if (registration) return settleLocal(input, registration.identity)
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
