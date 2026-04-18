import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createResource, createMemo, createSignal, onMount } from "solid-js"
import { Locale, Keybind } from "@/util"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { useKeybind } from "../context/keybind"
import { DialogSessionRescue } from "./dialog-session-rescue"
import type { GlobalSession } from "@opencode-ai/sdk/v2"

export function DialogSessionMigrate() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const [toDelete, setToDelete] = createSignal<string>()

  const [data, { refetch }] = createResource(async () => {
    const [res, orphans] = await Promise.all([
      sdk.fetch(`${sdk.url}/experimental/session?roots=true&limit=200`),
      sdk.client.session.orphans(),
    ])
    const all: GlobalSession[] = (await res.json()) ?? []
    const ids = new Set((orphans.data ?? []).map((x) => x.id))
    return { sessions: all, orphans: ids }
  })

  const options = createMemo(() => {
    const items = data()
    if (!items) return []
    const deleting = toDelete()
    return items.sessions.map((x) => ({
      title: deleting === x.id ? `Press ${keybind.print("session_delete")} again to confirm` : x.title,
      value: x.id,
      description: x.directory,
      footer: Locale.time(x.time.updated),
      category: x.project?.name ?? x.project?.worktree ?? "global",
      get gutter() {
        return items.orphans.has(x.id) ? <text fg={theme.warning}>!</text> : undefined
      },
    }))
  })

  onMount(() => {
    dialog.setSize("large")
  })

  return (
    <DialogSelect
      title="Migrate Session"
      placeholder="Search sessions"
      options={options()}
      onSelect={(option) => {
        const session = data()?.sessions.find((x) => x.id === option.value)
        if (!session) return
        dialog.replace(() => <DialogSessionRescue session={session} onDone={refetch} />)
      }}
      keybind={[
        {
          keybind: keybind.all.session_delete?.[0],
          title: "delete",
          onTrigger: async (option) => {
            if (toDelete() === option.value) {
              await sdk.client.session.delete({ sessionID: option.value })
              setToDelete(undefined)
              await refetch()
              return
            }
            setToDelete(option.value)
          },
        },
        {
          keybind: Keybind.parse("!")[0],
          title: "orphan",
          side: "right",
          onTrigger: () => {},
        },
      ]}
    />
  )
}
