import { DialogSelect } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useRoute } from "@tui/context/route"
import { useTheme } from "@tui/context/theme"
import { useToast } from "@tui/ui/toast"
import { useSync } from "@tui/context/sync"
import { Locale } from "@/util/locale"
import { getFilename } from "@opencode-ai/util/path"
import { createMemo, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import type { Automation, AutomationRun } from "@opencode-ai/sdk/v2"

export function DialogAutomationHistory(props: { automation: Automation }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const route = useRoute()
  const toast = useToast()
  const sync = useSync()
  const { theme } = useTheme()

  const [store, setStore] = createStore({
    runs: [] as AutomationRun[],
  })

  onMount(() => {
    dialog.setSize("large")
    sdk.client.automation
      .history({ automationID: props.automation.id, limit: 25 })
      .then((result) => {
        setStore("runs", result.data ?? [])
      })
      .catch(() => {
        toast.show({ message: "Failed to load history", variant: "error" })
      })
  })

  const options = createMemo(() =>
    store.runs.map((run) => {
      const status = run.status === "success" ? "Success" : "Failed"
      const gutter = run.status === "success" ? <text fg={theme.success}>S</text> : <text fg={theme.error}>F</text>
      const footer = run.sessionID ? `Session: ${run.sessionID}` : "Session: -"
      const project = getFilename(run.directory)
      const description = `${project} - ${status}`
      return {
        title: Locale.todayTimeOrDateTime(run.time),
        description,
        footer,
        gutter,
        value: run,
      }
    }),
  )

  const canOpenSession = (directory: string) => {
    if (!directory) return false
    if (sync.data.path.worktree && sync.data.path.worktree !== "/" && directory === sync.data.path.worktree) return true
    if (directory === sync.data.path.directory) return true
    return false
  }

  return (
    <DialogSelect
      title="Automation history"
      placeholder="Search runs..."
      options={options()}
      onSelect={(option) => {
        if (!option.value.sessionID) return
        if (!canOpenSession(option.value.directory)) {
          toast.show({ message: "Open this session from its project", variant: "error" })
          return
        }
        route.navigate({ type: "session", sessionID: option.value.sessionID })
      }}
    />
  )
}
