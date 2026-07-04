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
import { Tools, type CodeModeTools } from "./tools"
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
  readonly register: (tools: Readonly<Record<string, AnyTool>>) => Effect.Effect<void, RegistrationError, Scope.Scope>
  /**
   * Internal only. This is probably the wrong API: it mixes tool registration with CodeMode projection.
   * Keep it out of PluginContext until the tool catalog has a proper projection mechanism.
   */
  readonly codeMode: {
    readonly register: (tools: CodeModeTools) => Effect.Effect<void, RegistrationError, Scope.Scope>
  }
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
    type Registration = { readonly identity: object; readonly tool: AnyTool }
    type Stack = Array<{ readonly token: object; readonly registration: Registration }>
    const local = new Map<string, Stack>()
    const codeMode = new Map<string, Stack>()

    const settleWith = Effect.fn("ToolRegistry.settle")(function* (input: ExecuteInput, registration: Registration) {
      // Hooks fire only for hosted/local tools; provider-executed calls never reach settleWith.
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

    const register = Effect.fn("ToolRegistry.register")(function* (
      target: Map<string, Stack>,
      entries: ReadonlyArray<readonly [string, AnyTool]>,
    ) {
      if (entries.length === 0) return
      yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const token = {}
          for (const [name, tool] of entries)
            target.set(name, [...(target.get(name) ?? []), { token, registration: { identity: {}, tool } }])
          yield* Effect.addFinalizer(() =>
            Effect.sync(() => {
              for (const [name] of entries) {
                const registrations = target.get(name)?.filter((registration) => registration.token !== token) ?? []
                if (registrations.length > 0) target.set(name, registrations)
                else target.delete(name)
              }
            }),
          )
        }),
      )
    })

    const codeModeRegistrations = (rules: PermissionV2.Ruleset) =>
      Array.from(codeMode).flatMap(([path, entries]) => {
        const registration = entries.at(-1)?.registration
        const separator = path.indexOf("\u0000")
        const namespace = path.slice(0, separator)
        const name = path.slice(separator + 1)
        if (!registration || whollyDisabled(permission(registration.tool, `${namespace}.${name}`), rules)) return []
        return [{ namespace, name, registration }]
      })

    return Service.of({
      register: (tools) => register(local, registrationEntries(tools)),
      codeMode: {
        register: (tools) =>
          register(
            codeMode,
            Object.entries(tools).flatMap(([namespace, members]) =>
              Object.entries(members).map(
                ([name, tool]) => [`${executeSegment(namespace)}\u0000${executeSegment(name)}`, tool] as const,
              ),
            ),
          ),
      },
      materialize: Effect.fn("ToolRegistry.materialize")(function* (input) {
        const rules = [...(input.permissions ?? [])]
        const registrations = new Map<string, Registration>()
        for (const [name, entries] of local) {
          const registration = entries.at(-1)?.registration
          if (registration) registrations.set(name, registration)
        }
        // OpenAI/GPT models use apply_patch; every other model uses edit and write.
        const usePatch = input.model.provider.toLowerCase() === "openai" || input.model.id.toLowerCase().includes("gpt")
        for (const [name, registration] of registrations) {
          const wrongEditTool = name === "apply_patch" ? !usePatch : (name === "edit" || name === "write") && usePatch
          if (wrongEditTool || whollyDisabled(permission(registration.tool, name), rules)) registrations.delete(name)
        }

        const children = codeModeRegistrations(rules)
        const executeTools = new Map<string, Record<string, AnyTool>>()
        for (const child of children) {
          const members = executeTools.get(child.namespace) ?? {}
          members[child.name] = child.registration.tool
          executeTools.set(child.namespace, members)
        }
        const executeRegistration =
          children.length > 0 && !whollyDisabled("execute", rules)
            ? { identity: {}, tool: ExecuteTool.make(Object.fromEntries(executeTools)) }
            : undefined
        if (executeRegistration) registrations.set("execute", executeRegistration)

        return {
          definitions: Array.from(registrations, ([name, registration]) => definition(name, registration.tool)),
          settle: (input) =>
            Effect.suspend(() => {
              const registration = registrations.get(input.call.name)
              if (!registration)
                return Effect.succeed({ result: { type: "error" as const, value: `Unknown tool: ${input.call.name}` } })
              if (registration === executeRegistration) {
                const current = codeModeRegistrations(rules)
                if (
                  current.length !== children.length ||
                  current.some((item, index) => item.registration.identity !== children[index]?.registration.identity)
                )
                  return Effect.succeed({ result: { type: "error" as const, value: "Stale tool call: execute" } })
              } else {
                if (input.call.name === "execute" && codeModeRegistrations(rules).length > 0)
                  return Effect.succeed({ result: { type: "error" as const, value: "Stale tool call: execute" } })
                if (local.get(input.call.name)?.at(-1)?.registration.identity !== registration.identity)
                  return Effect.succeed({
                    result: { type: "error" as const, value: `Stale tool call: ${input.call.name}` },
                  })
              }
              return settleWith(input, registration)
            }),
        }
      }),
    })
  }),
)

const layer = Layer.effect(
  Tools.Service,
  Service.use((registry) =>
    Effect.succeed(
      Tools.Service.of({ register: registry.register, codeMode: { register: registry.codeMode.register } }),
    ),
  ),
).pipe(Layer.provideMerge(registryLayer))

function whollyDisabled(action: string, rules: PermissionV2.Ruleset) {
  const rule = rules.findLast((rule) => Wildcard.match(action, rule.action))
  return rule?.resource === "*" && rule.effect === "deny"
}

function executeSegment(value: string) {
  const name = value.replace(/[^a-zA-Z0-9_-]/g, "_")
  return name === "__proto__" || name === "constructor" || name === "prototype" ? `_${name}` : name
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
