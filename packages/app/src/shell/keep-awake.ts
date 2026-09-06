import { createEffect, createMemo, onCleanup, type Accessor } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { useTabs, type Tab } from "@/shell/tabs/tabs"

export function createOpenTabsKeepAwake(input: {
  tabs: Accessor<readonly Tab[]>
  running: (server: ServerConnection.Key, sessionID: string) => boolean
  setActive: (active: boolean) => Promise<void>
}) {
  const active = createMemo(() =>
    input
      .tabs()
      .some(
        (tab) =>
          tab.type === "session" &&
          (input.running(tab.server, tab.sessionId) ||
            (!!tab.routeSessionId && input.running(tab.server, tab.routeSessionId))),
      ),
  )
  const report = (value: boolean) => {
    void input.setActive(value).catch((error) => console.error("Failed to update desktop keep-awake activity", error))
  }
  createEffect(() => report(active()))
  onCleanup(() => report(false))
}

export function KeepAwake() {
  const platform = usePlatform()
  if (!platform.setKeepAwakeActive) return null
  const tabs = useTabs()
  const global = useGlobal()
  createOpenTabsKeepAwake({
    tabs: () => tabs.store,
    running: (server, sessionID) => {
      const conn = global.servers.list().find((item) => ServerConnection.key(item) === server)
      return !!conn && global.ensureServerCtx(conn).data.session.status(sessionID) === "running"
    },
    setActive: platform.setKeepAwakeActive,
  })
  return null
}
