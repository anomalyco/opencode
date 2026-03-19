import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createSignal, createEffect } from "solid-js"
import type { Plan, WorkerState } from "@/parallel/schema"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"

export function ParallelStatus(props: { plan: Plan }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sdk = useSDK()

  const running = () => props.plan.workers.filter((w) => w.status === "running").length
  const done = () => props.plan.workers.filter((w) => w.status === "done" || w.status === "merged").length
  const total = () => props.plan.workers.length

  const statusColor = (status: WorkerState["status"]) => {
    switch (status) {
      case "running":
        return theme.warning
      case "done":
      case "merged":
        return theme.success
      case "failed":
      case "conflict":
        return theme.error
      default:
        return theme.muted
    }
  }

  const statusIcon = (status: WorkerState["status"]) => {
    switch (status) {
      case "pending":
        return "○"
      case "spawning":
      case "running":
        return "●"
      case "done":
        return "✓"
      case "merged":
        return "✓"
      case "failed":
      case "conflict":
        return "✗"
      default:
        return "○"
    }
  }

  return (
    <box
      flexDirection="column"
      width={() => Math.min(80, dim().width - 2)}
      backgroundColor={theme.backgroundPanel}
      padding={1}
    >
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          Parallel Execution:
        </text>
        <text fg={theme.text}>
          {" "}
          {done()}/{total()} complete
        </text>
        <Show when={running() > 0}>
          <text fg={theme.warning}> ({running()} running)</text>
        </Show>
      </box>

      <box flexDirection="row" gap={1}>
        <For each={props.plan.workers}>
          {(worker, index) => {
            const subtask = () => props.plan.subtasks.find((s) => s.id === worker.subtaskID)
            const width = () => Math.floor((Math.min(80, dim().width - 2) - 2) / Math.min(3, total())) - 1

            return (
              <box
                flexDirection="column"
                width={width()}
                backgroundColor={theme.background}
                padding={1}
                borderStyle="round"
                borderColor={statusColor(worker.status)}
              >
                <box flexDirection="row" gap={1} marginBottom={1}>
                  <text fg={statusColor(worker.status)}>{statusIcon(worker.status)}</text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {subtask()?.title.slice(0, 15)}
                  </text>
                </box>

                <box flexDirection="column">
                  <text fg={theme.muted} wrap="wrap">
                    {worker.status}
                  </text>
                  <Show when={worker.error}>
                    <text fg={theme.error} wrap="wrap">
                      {worker.error?.slice(0, 50)}
                    </text>
                  </Show>
                  <Show when={worker.diffStat}>
                    <text fg={theme.accent}>
                      +{worker.diffStat?.additions} -{worker.diffStat?.deletions}
                    </text>
                  </Show>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      <box marginTop={1} paddingTop={1} borderTop={1} borderColor={theme.border}>
        <text fg={theme.muted}>Status: {props.plan.status}</text>
      </box>
    </box>
  )
}
