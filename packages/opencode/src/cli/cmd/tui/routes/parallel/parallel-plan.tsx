import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { For, createSignal, createMemo } from "solid-js"
import type { Plan, Subtask, ModelRef } from "@/parallel/schema"
import { useSDK } from "@tui/context/sdk"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { DialogSelect } from "@tui/ui/dialog-select"
import { TextAttributes } from "@opentui/core"
import { pipe, flatMap, entries, sortBy } from "remeda"

function SubtaskModelPicker(props: {
  subtask: Subtask
  workerDefault: ModelRef
  onSelect: (model: ModelRef) => void
}) {
  const sync = useSync()
  const dialog = useDialog()

  const current = () => props.subtask.model ?? props.workerDefault

  const options = createMemo(() =>
    pipe(
      sync.data.provider,
      flatMap((provider) =>
        pipe(
          entries(provider.models),
          sortBy(([, m]) => m.name ?? ""),
          flatMap(([modelID, model]) => [
            {
              key: { providerID: provider.id, modelID },
              value: { providerID: provider.id, modelID },
              title: model.name ?? modelID,
              description: provider.name,
              category: provider.name,
            },
          ]),
        ),
      ),
    ),
  )

  return (
    <DialogSelect
      title={`Model for: ${props.subtask.title}`}
      footer={`Current: ${current().providerID}/${current().modelID}`}
      options={options()}
      onSelect={(value) => {
        props.onSelect({ providerID: value.providerID, modelID: value.modelID })
        dialog.clear()
      }}
    />
  )
}

export function ParallelPlan(props: { plan: Plan; onApproved: () => void; onCancelled: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const [selected, setSelected] = createSignal(0)
  const [subtaskModels, setSubtaskModels] = createSignal<Record<string, ModelRef>>({})

  const width = () => Math.min(80, dim().width - 2)

  const resolvedModelLabel = (subtask: Subtask): string => {
    const override = subtaskModels()[subtask.id]
    if (override) return override.modelID
    if (subtask.model) return subtask.model.modelID
    return props.plan.workerModel.modelID
  }

  const isOverridden = (subtask: Subtask): boolean => {
    return !!(subtaskModels()[subtask.id] || subtask.model)
  }

  const handleApprove = async () => {
    try {
      const overrides = subtaskModels()
      const editedSubtasks = Object.keys(overrides).length > 0
        ? props.plan.subtasks.map((st) => {
            const override = overrides[st.id]
            return override ? { ...st, model: override } : st
          })
        : undefined

      await sdk.client.parallel.approve({ planID: props.plan.id, subtasks: editedSubtasks })
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

  const openModelPicker = (index: number) => {
    const subtask = props.plan.subtasks[index]
    if (!subtask) return
    dialog.replace(() => (
      <SubtaskModelPicker
        subtask={subtask}
        workerDefault={props.plan.workerModel}
        onSelect={(model) => {
          setSubtaskModels((prev) => ({ ...prev, [subtask.id]: model }))
        }}
      />
    ))
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    switch (evt.key) {
      case "a":
        evt.preventDefault()
        handleApprove()
        break
      case "r":
        evt.preventDefault()
        handleRegenerate()
        break
      case "c":
        evt.preventDefault()
        handleCancel()
        break
      case "m":
        evt.preventDefault()
        openModelPicker(selected())
        break
      case "ArrowUp":
      case "k":
        evt.preventDefault()
        setSelected((s) => Math.max(0, s - 1))
        break
      case "ArrowDown":
      case "j":
        evt.preventDefault()
        setSelected((s) => Math.min(props.plan.subtasks.length - 1, s + 1))
        break
    }
  })

  return (
    <box flexDirection="column" width={width()} backgroundColor={theme.backgroundPanel} padding={1}>
      <box marginBottom={1}>
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          Parallel Plan:
        </text>
        <text fg={theme.text}> {props.plan.task.slice(0, 50)}...</text>
      </box>

      <box marginBottom={1} flexDirection="row">
        <text fg={theme.muted}>Orchestrator: </text>
        <text fg={theme.text}>{props.plan.orchestratorModel.modelID}</text>
        <text fg={theme.muted}> | Worker default: </text>
        <text fg={theme.text}>{props.plan.workerModel.modelID}</text>
      </box>

      <box flexDirection="column" gap={1} marginBottom={1}>
        <text attributes={TextAttributes.UNDERLINE} fg={theme.text}>
          Subtasks ({props.plan.subtasks.length})
        </text>
        <For each={props.plan.subtasks}>
          {(subtask, index) => {
            const isSel = () => selected() === index()
            return (
              <box
                flexDirection="column"
                paddingLeft={1}
                backgroundColor={isSel() ? theme.backgroundHover : undefined}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={isSel() ? theme.primary : theme.muted}>{isSel() ? ">" : " "}</text>
                  <text fg={theme.primary}>{index() + 1}.</text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {subtask.title}
                  </text>
                  <text fg={isOverridden(subtask) ? theme.accent : theme.muted}>
                    [{resolvedModelLabel(subtask)}]
                  </text>
                </box>
                <box paddingLeft={3} flexDirection="column">
                  <text fg={theme.muted}>{subtask.description.slice(0, 100)}...</text>
                  <text fg={theme.accent}>Files: {subtask.fileScope.join(", ")}</text>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1} borderTop={1} borderColor={theme.border}>
        <box onMouseUp={handleApprove} backgroundColor={theme.primary} paddingX={2} paddingY={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.background}>
            [a]pprove
          </text>
        </box>
        <box onMouseUp={() => openModelPicker(selected())} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[m]odel</text>
        </box>
        <box onMouseUp={handleRegenerate} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[r]egenerate</text>
        </box>
        <box onMouseUp={handleCancel} paddingX={2} paddingY={1}>
          <text fg={theme.error}>[c]ancel</text>
        </box>
      </box>

      <box marginTop={1}>
        <text fg={theme.muted}>arrows to navigate | m change model | a approve | r regenerate | c cancel</text>
      </box>
    </box>
  )
}
