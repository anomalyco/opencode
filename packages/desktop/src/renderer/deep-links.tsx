import { ServerConnection, useGlobal, usePluginServers, useTabs } from "@opencode/app/desktop"
import { createEffect, onCleanup, untrack } from "solid-js"
import { sessionDeepLink } from "../shared/deep-links"
import type { ElectronAPI } from "./api-types"

/** Opens deep links in this window: one waiting when it starts, then each that arrives while it runs. */
export function DesktopDeepLinks(props: { api: ElectronAPI; local: ServerConnection.Key }) {
  const tabs = useTabs()
  const global = useGlobal()
  const pluginServers = usePluginServers()

  // The local server first, then the others in list order; the first that has the session opens it.
  const findServer = async (sessionID: string) => {
    const others = untrack(global.servers.list)
      .map(ServerConnection.key)
      .filter((key) => key !== props.local)

    for (const key of [props.local, ...others]) {
      const api = untrack(() => global.serverCtx(key))?.sdk.api

      if (!api) continue
      const found = await api.session.get({ sessionID }).then(
        () => true,
        () => false,
      )

      if (found) return key
    }
  }

  const take = async () => {
    const url = await props.api.takeDeepLink()
    const sessionID = url ? sessionDeepLink(url) : undefined

    if (!sessionID) return
    const server = await findServer(sessionID)

    if (!server) return console.warn("[deep-links] no server has session", sessionID)
    tabs.select(tabs.addSessionTab({ server, sessionId: sessionID }))
  }

  // Tabs added before the window's tabs hydrate would be replaced by them, and plugin servers must be listed
  // before the lookup can reach them.
  createEffect(() => {
    if (!tabs.ready() || !pluginServers.ready()) return
    const run = () => void take().catch((error) => console.error("[deep-links] failed to open", error))
    onCleanup(props.api.onDeepLink(run))
    run()
  })

  return null
}
