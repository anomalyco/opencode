import { useNavigate } from "@solidjs/router"
import { createMemo, createResource } from "solid-js"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServers } from "@/context/servers"
import { useSettings } from "@/context/settings"
import { useTabs } from "@/context/tabs"
import { type ServerHealth } from "@/utils/server-health"
import { showToast } from "@/utils/toast"

function showRequestError(language: ReturnType<typeof useLanguage>, err: unknown) {
  showToast({
    variant: "error",
    title: language.t("common.requestFailed"),
    description: err instanceof Error ? err.message : String(err),
  })
}

function useDefaultServer() {
  const language = useLanguage()
  const platform = usePlatform()
  const [defaultKey, defaultKeyActions] = createResource(
    async () => {
      try {
        return (await platform.getDefaultServer?.()) ?? null
      } catch (err) {
        showRequestError(language, err)
        return null
      }
    },
    { initialValue: null },
  )

  const set = async (key: ServerConnection.Key | null) => {
    try {
      await platform.setDefaultServer?.(key)
      defaultKeyActions.mutate(key)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return {
    key: () => defaultKey.latest,
    available: createMemo(() => !!platform.getDefaultServer && !!platform.setDefaultServer),
    set,
  }
}

export function useServerActionsController() {
  const server = useServers()
  const tabs = useTabs()
  const platform = usePlatform()
  const language = useLanguage()
  const defaults = useDefaultServer()

  const remove = async (key: ServerConnection.Key) => {
    try {
      if (key.startsWith("wsl:")) await platform.wslServers?.removeServer(key)
      tabs.removeServer(key)
      server.remove(key)
      if ((await platform.getDefaultServer?.()) === key) await defaults.set(null)
    } catch (err) {
      showRequestError(language, err)
    }
  }

  return { defaults, connection: { canRemove: server.canRemove, remove } }
}

export type ServerActionsController = ReturnType<typeof useServerActionsController>

export function useServerCollectionController() {
  const server = useServers()
  const global = useGlobal()
  const settings = useSettings()
  const actions = useServerActionsController()

  const items = createMemo(() => server.list)
  const sorted = createMemo(() => {
    const raw = items()
    const list = raw
    if (!list.length) return list
    const order = new Map(list.map((item, index) => [item, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      const diff =
        rank(global.servers.health[ServerConnection.key(a)]) - rank(global.servers.health[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  return {
    collection: {
      items: sorted,
      health: () => global.servers.health,
    },
    ...actions,
  }
}

export type ServerCollectionController = ReturnType<typeof useServerCollectionController>
