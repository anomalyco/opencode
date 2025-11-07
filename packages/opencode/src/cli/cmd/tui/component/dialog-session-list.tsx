import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, createSignal, onMount } from "solid-js"
import { Locale } from "@/util/locale"
import { Keybind } from "@/util/keybind"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { DialogSessionRename } from "./dialog-session-rename"

export function DialogSessionList() {
  const dialog = useDialog()
  const sync = useSync()
  const { theme } = useTheme()
  const route = useRoute()
  const sdk = useSDK()

  const [toDelete, setToDelete] = createSignal<string>()
  const [displayLimit, setDisplayLimit] = createSignal(20)

  const deleteKeybind = "ctrl+d"

  const currentSessionID = createMemo(() =>
    route.data.type === "session" ? route.data.sessionID : undefined,
  )

  const allSessions = createMemo(() => {
    const today = new Date().toDateString()
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .filter((x) => {
        // Filter out sessions with garbage titles
        const title = x.title.toLowerCase()
        return !title.includes("clarifying") && 
               !title.includes("parsing") && 
               !title.includes("invalid input") &&
               !title.includes("discussing adsad") &&
               !title.startsWith("new session -")
      })
      .sort((a, b) => b.time.updated - a.time.updated) // Sort by most recent first
  })

  const options = createMemo(() => {
    const today = new Date().toDateString()
    const sessions = allSessions().slice(0, displayLimit())
    const hasMore = allSessions().length > displayLimit()
    
    const opts = sessions.map((x) => {
      const date = new Date(x.time.updated)
      let category = date.toDateString()
      if (category === today) {
        category = "Today"
      }
      const isDeleting = toDelete() === x.id
      return {
        title: isDeleting ? `Press ${deleteKeybind} again to confirm` : x.title,
        bg: isDeleting ? theme.error : undefined,
        value: x.id,
        category,
        footer: Locale.time(x.time.updated),
      }
    })

    if (hasMore) {
      opts.push({
        title: `Load more... (${allSessions().length - displayLimit()} remaining)`,
        value: "__load_more__",
        category: "",
        footer: "",
      })
    }

    return opts
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      limit={50}
      current={currentSessionID()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        if (option.value === "__load_more__") {
          setDisplayLimit((prev) => prev + 20)
          return
        }
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
                path: {
                  id: option.value,
                },
              })
              setToDelete(undefined)
              // dialog.clear()
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
      ]}
    />
  )
}
