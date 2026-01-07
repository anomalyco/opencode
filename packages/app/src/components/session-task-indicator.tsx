import { createMemo, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { useSync } from "@/context/sync"
import { useLayout } from "@/context/layout"
import { useParams } from "@solidjs/router"

export function SessionTaskIndicator() {
  const sync = useSync()
  const layout = useLayout()
  const params = useParams()

  const taskStats = createMemo(() => {
    const sessionID = params.id
    if (!sessionID) return { completed: 0, total: 0, hasInProgress: false, hasIncomplete: false }
    const todos = sync.data.todo[sessionID] ?? []
    const completed = todos.filter((t) => t.status === "completed").length
    const hasInProgress = todos.some((t) => t.status === "in_progress")
    const hasIncomplete = todos.some((t) => t.status !== "completed")
    const total = todos.length
    return { completed, total, hasInProgress, hasIncomplete }
  })

  const handleClick = () => {
    const sessionKey = `${params.dir}${params.id ? "/" + params.id : ""}`
    const tabs = layout.tabs(sessionKey)
    if (tabs.active() === "tasks") {
      layout.review.close()
      return
    }
    if (!layout.review.opened()) layout.review.open()
    tabs.setActive("tasks")
  }

  return (
    <Show when={taskStats().hasIncomplete}>
      <Button variant="ghost" onClick={handleClick}>
        <div
          classList={{
            "size-1.5 rounded-full": true,
            "bg-icon-warning-base animate-pulse": taskStats().hasInProgress,
            "bg-icon-success-base": !taskStats().hasInProgress && taskStats().completed === taskStats().total,
            "bg-icon-weak": !taskStats().hasInProgress && taskStats().completed < taskStats().total,
          }}
        />
        <span class="text-12-regular text-text-weak">
          {taskStats().completed}/{taskStats().total} Tasks
        </span>
      </Button>
    </Show>
  )
}
