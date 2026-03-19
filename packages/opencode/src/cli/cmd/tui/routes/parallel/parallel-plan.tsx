import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions } from "@opentui/solid"
import { Show, For, createEffect, createSignal } from "solid-js"
import type { Plan, Subtask } from "@/parallel/schema"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { TextAttributes } from "@opentui/core"

export function ParallelPlan(props: { plan: Plan; onApproved: () => void; onCancelled: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const [editing, setEditing] = createSignal<number | null>(null)
  const [editingText, setEditingText] = createSignal("")

  const width = () => Math.min(80, dim().width - 2)

  const handleApprove = async () => {
    try {
      await sdk.client.parallel.approve({ planID: props.plan.id })
      props.onApproved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve plan")
    }
  }

  const handleCancel = async () => {
    try {
      await sdk.client.parallel.cancel({ planID: props.plan.id })
      props.onCancelled()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to cancel plan")
    }
  }

  const handleRegenerate = async () => {
    try {
      await sdk.client.parallel.regenerate({ planID: props.plan.id })
      toast.show({ message: "Regenerating plan...", variant: "info" })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to regenerate plan")
    }
  }

  return (
    <box flexDirection="column" width={width()} backgroundColor={theme.backgroundPanel} padding={1}>
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          Parallel Plan:
        </text>
        <text fg={theme.text}> {props.plan.task.slice(0, 50)}...</text>
      </box>

      <box marginBottom={1} flexDirection="column">
        <text fg={theme.muted}>Orchestrator: </text>
        <text fg={theme.text}>{props.plan.orchestratorModel.modelID}</text>
        <text fg={theme.muted}> | Worker: </text>
        <text fg={theme.text}>{props.plan.workerModel.modelID}</text>
      </box>

      <box flexDirection="column" gap={1} marginBottom={1}>
        <text attributes={TextAttributes.UNDERLINE} fg={theme.text}>
          Subtasks ({props.plan.subtasks.length})
        </text>
        <For each={props.plan.subtasks}>
          {(subtask, index) => (
            <box flexDirection="column" paddingLeft={1}>
              <box flexDirection="row" gap={1}>
                <text fg={theme.primary}>{index() + 1}.</text>
                <text fg={theme.text} attributes={TextAttributes.BOLD}>
                  {subtask.title}
                </text>
              </box>
              <box paddingLeft={2} flexDirection="column">
                <text fg={theme.muted}>{subtask.description.slice(0, 100)}...</text>
                <text fg={theme.accent}>Files: {subtask.fileScope.join(", ")}</text>
              </box>
            </box>
          )}
        </For>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1} borderTop={1} borderColor={theme.border}>
        <box onMouseUp={handleApprove} backgroundColor={theme.primary} paddingX={2} paddingY={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.background}>
            [a]pprove
          </text>
        </box>
        <box onMouseUp={handleRegenerate} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[r]egenerate</text>
        </box>
        <box onMouseUp={handleCancel} paddingX={2} paddingY={1}>
          <text fg={theme.error}>[c]ancel</text>
        </box>
      </box>
    </box>
  )
}
