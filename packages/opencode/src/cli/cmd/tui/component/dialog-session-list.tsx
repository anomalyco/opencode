import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { Keybind } from "@/util/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import "opentui-spinner/solid"

export function DialogSessionList() {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()
  const kv = useKV()

  const [toDelete, setToDelete] = createSignal<string>()
  const [search, setSearch] = createDebouncedSignal("", 150)

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const deleteKeybind = "ctrl+d"
  const pinKeybind = "ctrl+b"

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const allSessions = sessions().filter((x) => x.parentID === undefined)

    const pinned = allSessions
      .filter((x) => x.time.pinned !== undefined)
      .toSorted((a, b) => (b.time.pinned ?? 0) - (a.time.pinned ?? 0))

    const unpinned = allSessions
      .filter((x) => x.time.pinned === undefined)
      .toSorted((a, b) => b.time.updated - a.time.updated)

    const mapSession = (session: typeof allSessions[number], category: string) => {
      const isDeleting = toDelete() === session.id
      const status = sync.data.session_status?.[session.id]
      const isWorking = status?.type === "busy"
      return {
        title: isDeleting ? `Press ${deleteKeybind} again to confirm` : session.title,
        bg: isDeleting ? theme.error : undefined,
        value: session.id,
        category,
        footer: Locale.time(session.time.updated),
        gutter: isWorking ? (
          <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
            <spinner frames={spinnerFrames} interval={80} color={theme.primary} />
          </Show>
        ) : undefined,
      }
    }

    const pinnedOptions = pinned.map((x) => mapSession(x, "Bookmarks"))

    const unpinnedOptions = unpinned.map((x) => {
      const date = new Date(x.time.updated)
      const category = date.toDateString() === today ? "Today" : date.toDateString()
      return mapSession(x, category)
    })

    return [...pinnedOptions, ...unpinnedOptions]
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      skipFilter={true}
      current={currentSessionID()}
      onFilter={setSearch}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
      keybind={[
        {
          keybind: Keybind.parse(deleteKeybind)[0],
          title: "delete",
          onTrigger: async (option) => {
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
          keybind: Keybind.parse("ctrl+r")[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
        {
          keybind: Keybind.parse(pinKeybind)[0],
          title: "bookmark",
          onTrigger: async (option) => {
            const session = sessions().find((s) => s.id === option.value)
            if (!session) return
            const isPinned = session.time.pinned !== undefined
            await sdk.client.session.update({
              sessionID: option.value,
              time: { pinned: isPinned ? null : Date.now() },
            })
          },
        },
      ]}
    />
  )
}
