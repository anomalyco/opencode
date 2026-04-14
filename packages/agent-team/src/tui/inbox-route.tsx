import type { TuiPluginApi, TuiRouteDefinition } from "@opencode-ai/plugin/tui"

export function inboxRoute(api: TuiPluginApi): TuiRouteDefinition {
  return {
    name: "inbox",
    render: (input) => {
      return `Inbox` as any
    },
  }
}
