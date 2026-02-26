import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"
import { Keybind } from "@/util/keybind"

const EMPTY_FAVORITE = "__session_favorite_empty__"

export function DialogSessionList() {
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()
  const keybind = useKeybind()
  const { theme } = useTheme()
  const sdk = useSDK()
  const kv = useKV()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)
  const [favorite, setFavorite] = kv.signal<string[]>("session_favorites", [])
  const [favoriteOnly, setFavoriteOnly] = createSignal(false)
  const favorites = createMemo(() => new Set(favorite()))

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const result = sessions()
      .filter((x) => x.parentID === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .filter((x) => !favoriteOnly() || favorites().has(x.id))
      .map((x) => {
        const date = new Date(x.time.updated)
        let category = date.toDateString()
        if (category === today) {
          category = "Today"
        }
        const isDeleting = toDelete() === x.id
        const isFavorite = favorites().has(x.id)
        const status = sync.data.session_status?.[x.id]
        const isWorking = status?.type === "busy"
        return {
          title: isDeleting
            ? `Press ${keybind.print("session_delete")} again to confirm`
            : `${isFavorite ? "★ " : ""}${x.title}`,
          bg: isDeleting ? theme.error : undefined,
          value: x.id,
          category,
          footer: Locale.time(x.time.updated),
          gutter: isWorking ? <Spinner /> : undefined,
        }
      })

    if (!favoriteOnly() || result.length > 0) return result
    return [
      {
        title: "No favorite sessions",
        value: EMPTY_FAVORITE,
        footer: "Shift+Tab: Show all",
      },
    ]
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title={favoriteOnly() ? "Favorite Sessions" : "Sessions"}
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        if (option.value === EMPTY_FAVORITE) return
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse("ctrl+f")[0],
          title: "favorite",
          onTrigger: (option) => {
            if (option.value === EMPTY_FAVORITE) return
            setFavorite((old) => {
              const next: string[] = Array.isArray(old) ? old : []
              const result = next.includes(option.value)
                ? next.filter((x) => x !== option.value)
                : [option.value, ...next]
              if (favoriteOnly() && result.length === 0) {
                setFavoriteOnly(false)
              }
              return result
            })
            setToDelete(undefined)
          },
        },
        {
          keybind: Keybind.parse("shift+tab")[0],
          title: favoriteOnly() ? "show all" : "show favorites",
          onTrigger: () => {
            if (!favoriteOnly() && favorites().size === 0) return
            setFavoriteOnly((x) => !x)
            setToDelete(undefined)
          },
        },
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (option.value === EMPTY_FAVORITE) return
            if (toDelete() === option.value) {
              sdk.client.session.delete({
                sessionID: option.value,
              })
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            if (option.value === EMPTY_FAVORITE) return
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
