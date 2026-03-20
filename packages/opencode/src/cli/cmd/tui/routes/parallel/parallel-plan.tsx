import { useTheme } from "@tui/context/theme"
import { useTerminalDimensions, useKeyboard } from "@opentui/solid"
import { For, Show, createSignal, createMemo } from "solid-js"
import type { Plan, Subtask, ModelRef } from "@/parallel/schema"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useSync } from "@tui/context/sync"
import { lint } from "@/parallel/lint"
import { TextAttributes } from "@opentui/core"
import { pipe, flatMap, entries, sortBy, map, filter } from "remeda"

function SubtaskModelPicker(props: { subtask: Subtask; workerDefault: ModelRef; onSelect: (model: ModelRef) => void }) {
  const sync = useSync()
  const dialog = useDialog()

  const options = createMemo(() =>
    pipe(
      sync.data.provider,
      sortBy((p) => p.name),
      flatMap((provider) =>
        pipe(
          provider.models,
          entries(),
          filter(([_, info]) => info.status !== "deprecated"),
          sortBy(([, m]) => m.name ?? ""),
          map(([modelID, model]) => ({
            value: `${provider.id}/${modelID}`,
            title: model.name ?? modelID,
            description: provider.name,
            category: provider.name,
            onSelect: () => {
              props.onSelect({ providerID: provider.id, modelID } as ModelRef)
              dialog.clear()
            },
          })),
        ),
      ),
    ),
  )

  return <DialogSelect title={`Model for: ${props.subtask.title}`} options={options()} />
}

export function ParallelPlan(props: { plan: Plan; onApproved: () => void; onCancelled: () => void }) {
  const { theme } = useTheme()
  const dim = useTerminalDimensions()
  const toast = useToast()
  const dialog = useDialog()
  const [selected, setSelected] = createSignal(0)
  const [edits, setEdits] = createSignal<Record<string, ModelRef | null>>({})

  const width = () => Math.min(80, dim().width - 2)

  const has = (id: string): boolean => Object.prototype.hasOwnProperty.call(edits(), id)

  const resolvedModelLabel = (subtask: Subtask): string => {
    const override = edits()[subtask.id]
    if (override) return override.modelID
    if (has(subtask.id)) return props.plan.workerModel.modelID
    if (subtask.model) return subtask.model.modelID
    return props.plan.workerModel.modelID
  }

  const isOverridden = (subtask: Subtask): boolean => {
    return has(subtask.id) || !!subtask.model
  }

  const handleApprove = async () => {
    try {
      const overrides = edits()
      const touched = (id: string) => Object.prototype.hasOwnProperty.call(overrides, id)
      const editedSubtasks =
        Object.keys(overrides).length > 0
          ? props.plan.subtasks.map((st) => {
              if (!touched(st.id)) return st
              const override = overrides[st.id]
              if (override) return { ...st, model: override }
              const next = { ...st }
              delete next.model
              return next
            })
          : undefined

      const { Orchestrator } = await import("@/parallel/orchestrator")
      if (editedSubtasks) {
        const { PlanStore } = await import("@/parallel/plan")
        await PlanStore.update({ id: props.plan.id, subtasks: editedSubtasks })
      }
      await Orchestrator.approve(props.plan.id)
      props.onApproved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve plan")
    }
  }

  const handleCancel = async () => {
    dialog.replace(() => (
      <DialogSelect
        title="Cancel Plan?"
        options={[
          {
            title: "Yes, cancel",
            value: "confirm",
            description: "Abort the parallel plan",
            onSelect: async () => {
              try {
                const { Orchestrator } = await import("@/parallel/orchestrator")
                await Orchestrator.cancel(props.plan.id)
                dialog.clear()
                props.onCancelled()
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Failed to cancel plan")
              }
            },
          },
          {
            title: "No, keep it",
            value: "abort",
            description: "Return to the plan view",
            onSelect: () => dialog.clear(),
          },
        ]}
      />
    ))
  }

  const handleRegenerate = async () => {
    try {
      const { Orchestrator } = await import("@/parallel/orchestrator")
      await Orchestrator.retry(props.plan.id)
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
          setEdits((prev) => ({ ...prev, [subtask.id]: model }))
        }}
      />
    ))
  }

  const clearModel = (index: number) => {
    const subtask = props.plan.subtasks[index]
    if (!subtask) return
    setEdits((prev) => ({ ...prev, [subtask.id]: null }))
  }

  const openBulk = () => {
    const subtask = props.plan.subtasks[selected()]
    if (!subtask) return

    const pick = edits()[subtask.id] ?? subtask.model ?? props.plan.workerModel

    dialog.replace(() => (
      <DialogSelect
        title="Bulk Model Actions"
        options={[
          {
            title: "Copy selected model to all",
            value: "copy",
            description: `${pick.modelID} for every subtask`,
            onSelect: () => {
              setEdits(Object.fromEntries(props.plan.subtasks.map((item) => [item.id, pick])))
              dialog.clear()
            },
          },
          {
            title: "Clear all task overrides",
            value: "clear",
            description: "Use worker default for every subtask",
            onSelect: () => {
              setEdits(Object.fromEntries(props.plan.subtasks.map((item) => [item.id, null])))
              dialog.clear()
            },
          },
          {
            title: "Reset local edits",
            value: "reset",
            description: "Discard only unsaved model edits",
            onSelect: () => {
              setEdits({})
              dialog.clear()
            },
          },
          {
            title: "Close",
            value: "close",
            description: "Return to plan",
            onSelect: () => dialog.clear(),
          },
        ]}
      />
    ))
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.defaultPrevented) return
    if (evt.name === "a" || (evt.sequence === "a" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      handleApprove()
    } else if (evt.name === "r" || (evt.sequence === "r" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      handleRegenerate()
    } else if (evt.name === "c" || (evt.sequence === "c" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      handleCancel()
    } else if (evt.name === "m" || (evt.sequence === "m" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      openModelPicker(selected())
    } else if (evt.name === "u" || (evt.sequence === "u" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      clearModel(selected())
    } else if (evt.name === "b" || (evt.sequence === "b" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      openBulk()
    } else if (evt.name === "up" || (evt.sequence === "k" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      setSelected((s) => Math.max(0, s - 1))
    } else if (evt.name === "down" || (evt.sequence === "j" && !evt.ctrl)) {
      evt.preventDefault()
      evt.stopPropagation()
      setSelected((s) => Math.min(props.plan.subtasks.length - 1, s + 1))
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
        <text fg={theme.textMuted}>Orchestrator: </text>
        <text fg={theme.text}>{props.plan.orchestratorModel.modelID}</text>
        <text fg={theme.textMuted}> | Worker default: </text>
        <text fg={theme.text}>{props.plan.workerModel.modelID}</text>
      </box>

      <Show when={props.plan.error}>
        <box marginBottom={1} flexDirection="column">
          <text fg={theme.textMuted}>
            {props.plan.error!.code} @ {props.plan.error!.stage}
          </text>
          <text fg={theme.error} wrapMode="word">
            {props.plan.error!.message}
          </text>
        </box>
      </Show>

      {/* Lint warnings */}
      {(() => {
        const report = lint(props.plan.subtasks)
        if (report.issues.length === 0) return null
        return (
          <box marginBottom={1} flexDirection="column" borderStyle="single" borderColor={theme.border} padding={1}>
            <text fg={theme.textMuted} attributes={TextAttributes.UNDERLINE}>
              Lint ({report.summary.error} errors, {report.summary.warn} warnings)
            </text>
            <For each={report.issues.filter((i) => i.severity !== "info").slice(0, 5)}>
              {(issue) => (
                <box flexDirection="row" gap={1}>
                  <text
                    fg={
                      issue.severity === "error"
                        ? theme.error
                        : issue.severity === "warn"
                          ? theme.warning
                          : theme.textMuted
                    }
                  >
                    [{issue.severity}]
                  </text>
                  <text fg={theme.text}>{issue.code}</text>
                  <text fg={theme.textMuted} wrapMode="word">
                    {issue.message.slice(0, 60)}
                  </text>
                </box>
              )}
            </For>
          </box>
        )
      })()}

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
                backgroundColor={isSel() ? theme.backgroundElement : undefined}
              >
                <box flexDirection="row" gap={1}>
                  <text fg={isSel() ? theme.primary : theme.textMuted}>{isSel() ? ">" : " "}</text>
                  <text fg={theme.primary}>{index() + 1}.</text>
                  <text fg={theme.text} attributes={TextAttributes.BOLD}>
                    {subtask.title}
                  </text>
                  <text fg={isOverridden(subtask) ? theme.accent : theme.textMuted}>
                    [{resolvedModelLabel(subtask)}]
                  </text>
                </box>
                <box paddingLeft={3} flexDirection="column">
                  <text fg={theme.textMuted}>{subtask.description.slice(0, 100)}...</text>
                  <text fg={theme.accent}>Files: {subtask.fileScope.join(", ")}</text>
                </box>
              </box>
            )
          }}
        </For>
      </box>

      <box flexDirection="row" gap={2} paddingTop={1} borderStyle="single" borderColor={theme.border}>
        <box onMouseUp={handleApprove} backgroundColor={theme.primary} paddingX={2} paddingY={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.background}>
            [a]pprove
          </text>
        </box>
        <box onMouseUp={() => openModelPicker(selected())} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[m]odel</text>
        </box>
        <box onMouseUp={() => clearModel(selected())} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[u]nset</text>
        </box>
        <box onMouseUp={openBulk} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[b]ulk</text>
        </box>
        <box onMouseUp={handleRegenerate} paddingX={2} paddingY={1}>
          <text fg={theme.text}>[r]egenerate</text>
        </box>
        <box onMouseUp={handleCancel} paddingX={2} paddingY={1}>
          <text fg={theme.error}>[c]ancel</text>
        </box>
      </box>

      <box marginTop={1}>
        <text fg={theme.textMuted}>
          arrows to navigate | m model | u unset | b bulk | a approve | r regenerate | c cancel
        </text>
      </box>
    </box>
  )
}
