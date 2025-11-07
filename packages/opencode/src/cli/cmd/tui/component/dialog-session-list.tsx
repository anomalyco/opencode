import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createEffect, createMemo, createSignal, onMount } from "solid-js"
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

  const deleteKeybind = "ctrl+d"

  const currentSessionID = createMemo(() =>
    route.data.type === "session" ? route.data.sessionID : undefined,
  )

  const options = createMemo(() => {
    const today = new Date().toDateString()
    return sync.data.session
      .filter((x) => x.parentID === undefined)
      .map((x) => {
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
      .slice(0, 150)
  })

  createEffect(() => {
    console.log("session count", sync.data.session.length)
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Sessions"
      options={options()}
      current={currentSessionID()}
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
