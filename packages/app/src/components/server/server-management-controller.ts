import { useNavigate } from "@solidjs/router"
import { createMemo, createResource } from "solid-js"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { ServerConnection, useServer } from "@/context/server"
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
  const server = useServer()
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
  const server = useServer()
  const global = useGlobal()
  const settings = useSettings()
  const actions = useServerActionsController()

  const items = createMemo(() => {
    const current = server.current
    const list = server.list
    if (!current) return list
    if (!list.includes(current)) return [current, ...list]
    return [current, ...list.filter((item) => item !== current)]
  })
  const current = createMemo<ServerConnection.Any | undefined>(() =>
    settings.general.newLayoutDesigns()
      ? undefined
      : (items().find((item) => ServerConnection.key(item) === server.key) ?? items()[0]),
  )
  const sorted = createMemo(() => {
    const raw = items()
    const list = raw
    if (!list.length) return list
    const active = current()
    const order = new Map(list.map((item, index) => [item, index] as const))
    const rank = (value?: ServerHealth) => {
      if (value?.healthy === true) return 0
      if (value?.healthy === false) return 2
      return 1
    }
    return list.slice().sort((a, b) => {
      if (a === active) return -1
      if (b === active) return 1
      const diff =
        rank(global.servers.health[ServerConnection.key(a)]) - rank(global.servers.health[ServerConnection.key(b)])
      if (diff !== 0) return diff
      return (order.get(a) ?? 0) - (order.get(b) ?? 0)
    })
  })

  return {
    collection: {
      items: sorted,
      current,
      health: () => global.servers.health,
    },
    ...actions,
  }
}

export type ServerCollectionController = ReturnType<typeof useServerCollectionController>

export function useServerDomainController(options: { onSelect?: () => void } = {}) {
  const navigate = useNavigate()
  const server = useServer()
  const global = useGlobal()
  const collection = useServerCollectionController()

  const select = async (connection: ServerConnection.Any) => {
    if (global.servers.health[ServerConnection.key(connection)]?.healthy === false) return
    options.onSelect?.()
    navigate("/")
    queueMicrotask(() => server.setActive(ServerConnection.key(connection)))
  }

  return { ...collection, selection: { select } }
}

export type ServerDomainController = ReturnType<typeof useServerDomainController>
