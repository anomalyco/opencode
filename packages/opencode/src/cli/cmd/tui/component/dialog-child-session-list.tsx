import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useTheme } from "@tui/context/theme"
import { createMemo, onMount } from "solid-js"
import { buildChildSessionPickerOptions } from "../lib/child-session-picker"
import { sessionRunState } from "../lib/session-tree"
import "opentui-spinner/solid"

export function DialogChildSessionList(props: { sessionID: string }) {
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

  const options = createMemo(() => {
    const sessions = sync.data.session.map((s) => ({
      id: s.id,
      title: s.title,
      parentID: s.parentID,
      time: { created: s.time.created, updated: s.time.updated },
    }))

    const baseOptions = buildChildSessionPickerOptions({
      currentSessionID: props.sessionID,
      sessions,
      permissionsBySession: sync.data.permission,
    }).options

    // Enhance options with status indicators
    return baseOptions.map((opt) => {
      const pending = sync.data.permission[opt.value]?.length ?? 0
      const status = sync.data.session_status?.[opt.value] as { type?: string } | undefined
      const state = sessionRunState(status)

      const session = sync.data.session.find((s) => s.id === opt.value)
      const isSubagent = session?.parentID !== undefined

      const gutter = (() => {
        if (pending > 0) return <text fg={theme.warning}>!</text>
        if (!isSubagent) return
        if (state === "working") return <spinner frames={spinnerFrames} interval={80} color={theme.warning} />
        if (state === "waiting") return <text fg={theme.accent}>◎</text>
        return <text fg={theme.success}>●</text>
      })()

      return {
        ...opt,
        gutter,
      }
    })
  })

  return (
    <DialogSelect
      title="Session Tree"
      options={options()}
      current={props.sessionID}
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
