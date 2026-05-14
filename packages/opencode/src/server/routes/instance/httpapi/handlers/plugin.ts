import { Plugin } from "@/plugin"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import type { SidebarPanel, SidebarPanelItem, SidebarPanelStatus } from "@opencode-ai/plugin"

export const pluginHandlers = HttpApiBuilder.group(InstanceHttpApi, "plugin", (handlers) =>
  Effect.gen(function* () {
    const plugin = yield* Plugin.Service

    return handlers.handle("sidebar", () =>
      Effect.gen(function* () {
        const hooks = yield* plugin.list()

        const panels: Array<{
          id: string
          title: string
          items: Array<{ label: string; value?: string; status?: SidebarPanelStatus }>
        }> = []

        for (const hook of hooks) {
          if (!hook.sidebar) continue
          const resolved = typeof hook.sidebar === "function" ? await hook.sidebar() : hook.sidebar
          for (const panel of resolved) {
            const items =
              typeof panel.items === "function"
                ? await panel.items()
                : panel.items

            panels.push({
              id: panel.id,
              title: panel.title,
              items: items.map((item: any) => ({
                label: item.label,
                value: item.value,
                status: item.status,
              })),
            })
          }
        }

        return { panels }
      }),
    )
  }),
)
