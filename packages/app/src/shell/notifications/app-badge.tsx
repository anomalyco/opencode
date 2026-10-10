import { createEffect, createMemo, onCleanup } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { usePlatform } from "@/runtime/platform/platform"
import { useLayout } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"

export function AppBadge() {
  const platform = usePlatform()
  if (platform.platform !== "web" || !navigator.setAppBadge || !navigator.clearAppBadge) return null
  const global = useGlobal()
  const servers = useServers()
  const layout = useLayout()
  const tabs = useTabs()
  const server = createMemo(() => {
    const route = layout.route()
    const key =
      route.type === "session"
        ? route.server
        : route.type === "draft"
          ? tabs.store.find((tab) => tab.type === "draft" && tab.draftID === route.draftID)?.server
          : layout.home.selection().server
    return servers.visible.find((conn) => ServerConnection.key(conn) === key) ?? servers.visible[0]
  })
  createEffect(() => {
    const conn = server()
    const count = conn ? (global.serverCtx(ServerConnection.key(conn))?.notification.attention().length ?? 0) : 0
    void (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {})
  })
  onCleanup(() => {
    void navigator.clearAppBadge().catch(() => {})
  })
  return null
}
