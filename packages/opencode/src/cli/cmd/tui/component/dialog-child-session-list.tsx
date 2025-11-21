import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo, onMount } from "solid-js"
import { Locale } from "@/util/locale"

export function DialogChildSessionList() {
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()

  const currentSessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))
  const currentSession = createMemo(() => sync.session.get(currentSessionID()!))

  const options = createMemo(() => {
    const current = currentSession()
    if (!current) return []

    const parentID = current.parentID ?? current.id

    const allSessions = sync.data.session
      .filter((x) => x.id === parentID || x.parentID === parentID)
      .toSorted((b, a) => a.id.localeCompare(b.id))

    return allSessions.map((x) => {
      const isParent = x.id === parentID
      const label = isParent ? "Parent" : "Child"

      return {
        title: `${x.title}`,
        value: x.id,
        category: label,
        footer: Locale.time(x.time.updated),
      }
    })
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Child Sessions"
      options={options()}
      current={currentSessionID()}
      onSelect={(option) => {
        route.navigate({
          type: "session",
          sessionID: option.value,
        })
        dialog.clear()
      }}
    />
  )
}
