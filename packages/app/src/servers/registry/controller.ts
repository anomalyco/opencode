import { createMemo } from "solid-js"
import { useGlobal } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { type ServerHealth } from "@/runtime/server/health"
import { showToast } from "@/shell/notifications/toast"
import { useExtensionServers } from "@/runtime/extension/servers"

export function sortServerConnections(input: {
  servers: ServerConnection.Any[]
  health: Record<string, ServerHealth | undefined>
}) {
  const order = new Map(input.servers.map((item, index) => [item, index] as const))

  const rank = (value?: ServerHealth) => {
    if (value?.healthy === true) return 0

    if (value?.healthy === false) return 2

    return 1
  }

  return input.servers.slice().sort((a, b) => {
    const health = rank(input.health[ServerConnection.key(a)]) - rank(input.health[ServerConnection.key(b)])

    if (health !== 0) return health

    return (order.get(a) ?? 0) - (order.get(b) ?? 0)
  })
}

export function useServerActionsController() {
  const server = useServers()
  const extensions = useExtensionServers()
  const tabs = useTabs()
  const language = useLanguage()

  const remove = async (key: ServerConnection.Key) => {
    try {
      await extensions.entry(key)?.entry.remove?.()
      tabs.removeServer(key)
      server.remove(key)
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    connection: {
      canRemove: server.canRemove,
      remove,
      canHide: (key: ServerConnection.Key) => {
        const conn = server.list.find((item) => ServerConnection.key(item) === key)

        return server.visible.length > 1 && !!conn && ServerConnection.builtin(conn)
      },
      isHidden: (key: ServerConnection.Key) => server.isHidden(key),
      setHidden: (key: ServerConnection.Key, hidden: boolean) => server.setHidden(key, hidden),
    },
  }
}

export type ServerActionsController = ReturnType<typeof useServerActionsController>

export function useServerCollectionController() {
  const server = useServers()
  const global = useGlobal()
  const actions = useServerActionsController()

  const items = createMemo(() => server.list)

  const sorted = createMemo(() =>
    sortServerConnections({
      servers: items(),
      health: global.servers.health,
    }),
  )

  return {
    collection: {
      items: sorted,
      health: () => global.servers.health,
    },
    ...actions,
  }
}

export type ServerCollectionController = ReturnType<typeof useServerCollectionController>
