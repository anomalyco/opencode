import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { createResource, createMemo, onMount } from "solid-js"
import { Locale } from "@/util"
import { useSDK } from "../context/sdk"
import { useTheme } from "../context/theme"
import { DialogSessionRescue } from "./dialog-session-rescue"
import type { GlobalSession } from "@opencode-ai/sdk/v2"

export function DialogSessionMigrate() {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()

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
    return items.sessions.map((x) => ({
      title: x.title,
      value: x.id,
      description: x.directory,
      footer: Locale.time(x.time.updated),
      category: x.project?.name ?? x.project?.worktree ?? "global",
      gutter: items.orphans.has(x.id) ? <text fg={theme.warning}>!</text> : undefined,
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
    />
  )
}
