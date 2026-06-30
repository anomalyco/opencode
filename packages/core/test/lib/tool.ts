import { AgentV2 } from "@opencode-ai/core/agent"
import type { PermissionV2 } from "@opencode-ai/core/permission"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ToolRegistry } from "@opencode-ai/core/tool/registry"
import { Effect } from "effect"

export const toolIdentity = {
  agent: AgentV2.ID.make("build"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_test"),
}

// Default fixture model: a non-OpenAI provider, so edit and write are the materialized edit tools.
export const testModel: ToolRegistry.MaterializeInput["model"] = { id: "claude-test", provider: "anthropic" }

export const toolDefinitions = (
  registry: ToolRegistry.Interface,
  permissions?: PermissionV2.Ruleset,
  model = testModel,
) => registry.materialize({ permissions, model }).pipe(Effect.map((materialized) => materialized.definitions))

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

export const settleTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput, model = testModel) =>
  registry.materialize({ model }).pipe(Effect.flatMap((materialized) => materialized.settle(input)))

export const executeTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput, model = testModel) =>
  settleTool(registry, input, model).pipe(Effect.map((settlement) => settlement.result))
