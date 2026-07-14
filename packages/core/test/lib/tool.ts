import { AgentV2 } from "@opencode-ai/core/agent"
import type { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Tool } from "@opencode-ai/core/tool/tool"
import { Tools } from "@opencode-ai/core/tool/tools"
import type { Context as PluginContext } from "@opencode-ai/plugin/v2/effect/plugin"
import { Effect, type Scope } from "effect"
import { host } from "../plugin/host"

export const toolIdentity = {
  agent: AgentV2.ID.make("build"),
  messageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (registry: ToolRegistry.Interface, permissions?: PermissionV2.Ruleset) =>
  registry.materialize(permissions).pipe(Effect.map((materialized) => materialized.definitions))

export function waitForTool(
  registry: ToolRegistry.Interface,
  name: string,
  remaining = 1000,
): Effect.Effect<void, Error> {
  return Effect.gen(function* () {
    if ((yield* toolDefinitions(registry)).some((tool) => tool.name === name)) return
    if (remaining === 0) {
      yield* Effect.fail(new Error(`Timed out waiting for tool: ${name}`))
      return
    }
    yield* Effect.promise(() => Bun.sleep(1))
    yield* waitForTool(registry, name, remaining - 1)
  })
}

/**
 * Registers a core tool plugin's tools against the real registry without booting the
 * full plugin host. Only the tool domain is live; focused tool tests exercise
 * registration, materialization, and settlement through the same path production uses.
 */
export const registerToolPlugin = <R>(plugin: {
  readonly id: string
  readonly effect: (context: PluginContext) => Effect.Effect<void, never, R>
}): Effect.Effect<void, never, R | Tools.Service | Scope.Scope> =>
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const context = host({
      tool: {
        transform: (callback) =>
          Effect.gen(function* () {
            const registrations: Array<{
              readonly name: string
              readonly tool: Tool.AnyTool
              readonly options?: Tool.RegisterOptions
            }> = []
            callback({
              add: (name, tool, options) => {
                registrations.push({ name, tool, ...(options ? { options } : {}) })
              },
            })
            yield* Effect.forEach(
              registrations,
              (registration) => tools.register({ [registration.name]: registration.tool }, registration.options),
              { discard: true },
            ).pipe(Effect.orDie)
            return { dispose: Effect.void }
          }),
        hook: () => Effect.die("registerToolPlugin does not support tool hooks"),
      },
    })
    yield* plugin.effect(context)
  })

export const settleTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  registry.materialize().pipe(Effect.flatMap((materialized) => materialized.settle(input)))

export const executeTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  settleTool(registry, input).pipe(Effect.map((settlement) => settlement.result))
