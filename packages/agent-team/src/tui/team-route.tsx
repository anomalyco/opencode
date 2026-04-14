import type { TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"

export function teamRoute(api: TuiPluginApi): TuiRouteDefinition {
  return {
    name: "team",
    render: (input) => {
      return `Team Dashboard` as any
    },
  }
}
