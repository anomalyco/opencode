import type { TuiPluginApi, TuiPluginMeta } from "@opencode-ai/plugin/tui"
import type { PluginOptions } from "@opencode-ai/plugin"
import { teamRoute } from "./tui/team-route.js"
import { inboxRoute } from "./tui/inbox-route.js"
import { agentDetailRoute } from "./tui/agent-detail-route.js"
import { sidebarSlot } from "./tui/sidebar-slot.js"

export default {
  id: "agent-team",
  tui: async (api: TuiPluginApi, options: PluginOptions | undefined, meta: TuiPluginMeta): Promise<void> => {
    api.route.register([teamRoute(api), inboxRoute(api), agentDetailRoute(api)])
    api.slots.register(sidebarSlot(api))

    api.command.register(() => [
      {
        title: "Open Team Dashboard",
        value: "team.open",
        keybind: "ctrl+t",
        onSelect: () => api.route.navigate("team"),
      },
      { title: "Open Inbox", value: "team.inbox", onSelect: () => api.route.navigate("inbox") },
      { title: "Spawn Agent", value: "team.spawn" },
      { title: "Team Cost Report", value: "team.cost" },
      { title: "View Agent Detail", value: "team.agent.detail" },
    ])

    const unsub1 = api.event.on("session.idle" as any, () => {})

    api.lifecycle.onDispose(() => {
      unsub1()
    })
  },
}
