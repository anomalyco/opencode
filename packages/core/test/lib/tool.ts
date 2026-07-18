import { AgentV2 } from "@kancode/core/agent"
import { SessionMessage } from "@kancode/core/session/message"
import { ToolRegistry } from "@kancode/core/tool/registry"
import { Effect } from "effect"

export const toolIdentity = {
  agent: AgentV2.ID.make("default"),
  assistantMessageID: SessionMessage.ID.make("msg_tool_test"),
}

export const toolDefinitions = (
  registry: ToolRegistry.Interface,
  permissions?: Parameters<typeof registry.materialize>[0],
) => registry.materialize(permissions).pipe(Effect.map((materialized) => materialized.definitions))

export const settleTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  registry.materialize().pipe(Effect.flatMap((materialized) => materialized.settle(input)))

export const executeTool = (registry: ToolRegistry.Interface, input: ToolRegistry.ExecuteInput) =>
  settleTool(registry, input).pipe(Effect.map((settlement) => settlement.result))
