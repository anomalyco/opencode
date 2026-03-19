import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { For, Show, createSignal, createEffect, onCleanup } from "solid-js"
import type { Plan, WorkerState } from "@/parallel/schema"
import { TextAttributes } from "@opentui/core"
import { useSDK } from "@tui/context/sdk"
import { Spinner } from "@tui/component/spinner"

type MergeStatus = "clean" | "resolved" | "failed" | "pending" | "merging"

export function ParallelMerge(props: { plan: Plan }) {
  // Test 3: ESC fix validation comment
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sdk = useSDK()
  const [progressMap, setProgressMap] = createSignal<Record<string, MergeStatus>>({})

  // Listen to MergeProgress events via SSE
  createEffect(() => {
    const id = props.plan.id
    if (!id) return

    let es: EventSource | null = null

    // Check if EventSource is available (browser environment)
    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource(`${sdk.url}/parallel/${id}/events`)

        es.addEventListener("message", (e: MessageEvent) => {
          try {
            const data = JSON.parse(e.data)
            if (data.type === "parallel.merge.progress") {
              const { branch, result } = data.payload
              setProgressMap((prev) => ({
                ...prev,
                [branch]: result,
              }))
            }
          } catch {}
        })

        es.addEventListener("error", () => {
          // Will reconnect automatically
        })
      } catch {
        // EventSource not available
      }
    }

    onCleanup(() => {
      if (es) es.close()
    })
  })

  const mergeColor = (result: MergeStatus) => {
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

  const mergeIcon = (result: MergeStatus) => {
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

  const workerMergeStatus = (worker: WorkerState): MergeStatus => {
    if (worker.status === "merged") return "clean"
    if (worker.status === "conflict") return "failed"
    if (worker.status === "done") {
      const branchProgress = progressMap()[worker.branch ?? ""]
      return branchProgress ?? "merging"
    }
    return "pending"
  }

  const completed = () =>
    props.plan.workers.filter((w) => w.status === "done" || w.status === "merged" || w.status === "conflict").length
  const total = () => props.plan.workers.length
  const isMerging = () => props.plan.workers.some((w) => w.status === "done" && !progressMap()[w.branch ?? ""])

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

      <Show when={isMerging()}>
        <box marginBottom={1}>
          <Spinner color={theme.warning}>Merging branches...</Spinner>
        </box>
      </Show>

      <box flexDirection="column" gap={1}>
        <For each={props.plan.workers}>
          {(worker) => {
            const subtask = () => props.plan.subtasks.find((s) => s.id === worker.subtaskID)
            const status = () => workerMergeStatus(worker)
            const isActive = () => status() === "merging"

            return (
              <box flexDirection="row" gap={2}>
                <Show when={isActive()} fallback={<text fg={mergeColor(status())}>{mergeIcon(status())}</text>}>
                  <Spinner color={theme.warning} />
                </Show>
                <text fg={theme.text}>{subtask()?.title}</text>
                <text fg={theme.textMuted}>— {status()}</text>
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
