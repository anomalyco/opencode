import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, createResource, onMount, Show } from "solid-js"
import { Locale } from "@/util/locale"
import { useKeybind } from "../context/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"
import { useKV } from "../context/kv"
import { createDebouncedSignal } from "../util/signal"
import { Spinner } from "./spinner"

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

  const [searchResults] = createResource(search, async (query) => {
    if (!query) return undefined
    const result = await sdk.client.session.list({ search: query, limit: 30 })
    return result.data ?? []
  })

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const sessions = createMemo(() => searchResults() ?? sync.data.session)

  function parseSessionTitle(title: string): { group?: string; displayTitle: string } {
    const pipeIndex = title.indexOf("|")
    if (pipeIndex === -1) {
      return { displayTitle: title }
    }

    const group = title.slice(0, pipeIndex).trim()
    const displayTitle = title.slice(pipeIndex + 1).trim()

    if (!group) {
      return { displayTitle }
    }

    return { group, displayTitle }
  }

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const allSessions = sessions().filter((x) => x.parentID === undefined)

    // Separate into grouped and ungrouped
    const grouped: typeof allSessions = []
    const ungrouped: typeof allSessions = []

    for (const session of allSessions) {
      const parsed = parseSessionTitle(session.title)
      if (parsed.group) {
        grouped.push(session)
      } else {
        ungrouped.push(session)
      }
    }

    // Sort grouped by group name ASC, then updated DESC
    grouped.sort((a, b) => {
      const aParsed = parseSessionTitle(a.title)
      const bParsed = parseSessionTitle(b.title)
      const groupCompare = (aParsed.group ?? "").localeCompare(bParsed.group ?? "")
      if (groupCompare !== 0) return groupCompare
      return b.time.updated - a.time.updated
    })

    // Sort ungrouped by updated DESC
    ungrouped.sort((a, b) => b.time.updated - a.time.updated)

    // Map grouped sessions
    const groupedOptions = grouped.map((session) => {
      const parsed = parseSessionTitle(session.title)
      const isDeleting = toDelete() === session.id
      const status = sync.data.session_status?.[session.id]
      const isWorking = status?.type === "busy"
      return {
        title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : parsed.displayTitle,
        bg: isDeleting ? theme.error : undefined,
        value: session.id,
        category: parsed.group,
        footer: Locale.shortDateTime(session.time.updated),
        gutter: isWorking ? <Spinner /> : undefined,
      }
    })

    // Map ungrouped sessions
    const ungroupedOptions = ungrouped.map((session) => {
      const date = new Date(session.time.updated)
      let category = date.toDateString()
      if (category === today) {
        category = "Today"
      }
      const isDeleting = toDelete() === session.id
      const status = sync.data.session_status?.[session.id]
      const isWorking = status?.type === "busy"
      return {
        title: isDeleting ? `Press ${keybind.print("session_delete")} again to confirm` : session.title,
        bg: isDeleting ? theme.error : undefined,
        value: session.id,
        category,
        footer: Locale.time(session.time.updated),
        gutter: isWorking ? <Spinner /> : undefined,
      }
    })

    return [...groupedOptions, ...ungroupedOptions]
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
          keybind: keybind.all.session_delete?.[0],
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
          keybind: keybind.all.session_rename?.[0],
          title: "rename",
          onTrigger: async (option) => {
            dialog.replace(() => <DialogSessionRename session={option.value} />)
          },
        },
      ]}
    />
  )
}
