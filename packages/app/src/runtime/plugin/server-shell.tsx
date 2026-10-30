import { Match } from "effect"
import { createEffect, createMemo, Show, type ParentProps } from "solid-js"
import { usePlatform } from "@/runtime/platform/platform"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useCurrentRoute } from "@/shell/state/layout"
import { useTabs } from "@/shell/tabs/tabs"
import { Contribution } from "./render"
import { usePluginServers } from "./servers"

/**
 * Keeps the routed session or draft mounted and lets its server's plugin cover it while the
 * server is not ready.
 */
export function PluginServerCover(props: ParentProps) {
  const servers = usePluginServers()
  const route = useCurrentRoute()
  const tabs = useTabs()

  const covered = createMemo(() => {
    const current = route()

    const key = Match.value(current).pipe(
      Match.when({ type: "session" }, (session) => session.server),
      Match.when(
        { type: "draft" },
        (draft) => tabs.store.find((tab) => tab.type === "draft" && tab.draftID === draft.draftID)?.server,
      ),
      Match.orElse(() => undefined),
    )

    if (!key) return
    const source = servers.entry(key)

    if (!source?.entry.cover || source.entry.state === "ready") return

    return source.key
  })

  const tab = () => {
    const current = route()

    if (current.type === "session") return `${current.server}:${current.sessionId}`

    if (current.type === "draft") return current.draftID

    return ""
  }

  return (
    <div class="relative flex size-full min-h-0 min-w-0 flex-col">
      {/* Keep the route mounted so reconnecting preserves its draft and local UI state. */}
      <div
        class="flex size-full min-h-0 min-w-0 flex-col"
        classList={{ invisible: !!covered() }}
        inert={!!covered()}
        aria-hidden={covered() ? true : undefined}
      >
        {props.children}
      </div>
      <Show when={covered()} keyed>
        {(key) => {
          const source = servers.entry(key)
          const cover = source?.entry.cover

          if (!source || !cover) return null

          return (
            <div class="absolute inset-0">
              <Contribution plugin={source.plugin}>
                {() =>
                  cover({
                    get tab() {
                      return tab()
                    },
                  })
                }
              </Contribution>
            </div>
          )
        }}
      </Show>
    </div>
  )
}

/** Tells main the server endpoints so main plugins can reach them. */
export function PluginServerEndpoints() {
  const servers = useServers()
  const bridge = usePlatform().plugins

  if (bridge) {
    const sent = { value: "" }
    createEffect(() => {
      const endpoints = servers.list.flatMap((conn) => {
        // Main knows the built-in server first-hand; a contributed server has no endpoint until it is ready.
        if (conn.type === "sidecar" || (conn.type === "plugin" && conn.state !== "ready")) return []
        const password = conn.http.password

        const endpoint = { id: ServerConnection.key(conn), url: conn.http.url }

        return [password ? { ...endpoint, password } : endpoint]
      })

      const value = JSON.stringify(endpoints)

      if (value === sent.value) return
      sent.value = value
      bridge.configure(endpoints)
    })
  }

  return null
}
