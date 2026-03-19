import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show } from "solid-js"
import type { Plan, WorkerState } from "@/parallel/schema"
import { TextAttributes } from "@opentui/core"

export function ParallelMerge(props: { plan: Plan }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()

  const mergeColor = (result: "clean" | "resolved" | "failed" | "pending" | "merging") => {
    switch (result) {
      case "clean":
        return theme.success
      case "resolved":
        return theme.warning
      case "failed":
        return theme.error
      case "merging":
        return theme.warning
      default:
        return theme.textMuted
    }
  }

  const mergeIcon = (result: "clean" | "resolved" | "failed" | "pending" | "merging") => {
    switch (result) {
      case "clean":
        return "✓"
      case "resolved":
        return "✓"
      case "failed":
        return "✗"
      case "merging":
        return "●"
      default:
        return "○"
    }
  }

  const workerMergeStatus = (worker: WorkerState): "clean" | "resolved" | "failed" | "pending" | "merging" => {
    if (worker.status === "merged") return "clean"
    if (worker.status === "conflict") return "failed"
    if (worker.status === "done") return "pending"
    return "pending"
  }

  const completed = () =>
    props.plan.workers.filter((w) => w.status === "done" || w.status === "merged" || w.status === "conflict").length
  const total = () => props.plan.workers.length

  return (
    <box
      flexDirection="column"
      width={Math.min(80, dim().width - 2)}
      backgroundColor={theme.backgroundPanel}
      padding={1}
    >
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          Merge Progress
        </text>
        <text fg={theme.text}>
          {" "}
          {completed()}/{total()} merged
        </text>
      </box>

      <box flexDirection="column" gap={1}>
        <For each={props.plan.workers}>
          {(worker) => {
            const subtask = () => props.plan.subtasks.find((s) => s.id === worker.subtaskID)
            const status = workerMergeStatus(worker)

            return (
              <box flexDirection="row" gap={2}>
                <text fg={mergeColor(status)}>{mergeIcon(status)}</text>
                <text fg={theme.text}>{subtask()?.title}</text>
                <text fg={theme.textMuted}>— {status}</text>
                <Show when={worker.branch}>
                  <text fg={theme.accent}>({worker.branch?.slice(0, 20)})</text>
                </Show>
              </box>
            )
          }}
        </For>
      </box>

      <box marginTop={1} paddingTop={1}>
        <text fg={theme.textMuted}>Merging in order of diff size (smallest first)</text>
      </box>
    </box>
  )
}
