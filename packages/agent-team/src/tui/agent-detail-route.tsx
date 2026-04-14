import type { TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"

export function agentDetailRoute(api: TuiPluginApi): TuiRouteDefinition {
  return {
    name: "agent-detail",
    render: (input) => {
      const agentId = (input.params?.agentId as string) ?? ""
      return `Agent Detail: ${agentId}` as any
    },
  }
}
