import { TextAttributes, type TextareaRenderable } from "@opentui/core"
import type { WorkflowRun } from "@opencode-ai/sdk/v2"
import { createMemo, createSignal, For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useSDK } from "../context/sdk"
import { selectedForeground, useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"
import { answerWorkflowRun } from "./dialog-workflow-client"
import { isResumeAnswer, questionOptions, selectedAnswer, shouldEnableNav } from "./dialog-workflow-question-helpers"

// Thin Solid component for the question dialog (Spec §5.2 (4)): renders the
// question + declared options + a free-text entry, and submits the resolved
// answer via the generated `sdk.client.workflow.answer` route (answerWorkflowRun).
// All decision logic (option list, answer resolution, resume detection) lives in
// dialog-workflow-question-helpers; this component only wires render + I/O.
// `onClose(resumeRunID?)` is called with the NEW run id when answering a parked
// run spawned a resume run, so the caller can follow it into its detail view.
export function DialogWorkflowQuestion(props: {
  run: WorkflowRun
  sessionID?: string
  onClose: (resumeRunID?: string) => void
}) {
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable | undefined

  const pending = createMemo(() => props.run.pending_question)
  const options = createMemo(() => (pending() ? questionOptions(pending()!) : []))
  const [store, setStore] = createStore({ active: 0, submitting: false })

  function move(direction: number) {
    const count = options().length
    if (count === 0) return
    setStore("active", (store.active + direction + count) % count)
  }

  async function submit() {
    if (store.submitting) return
    const answer = selectedAnswer(options(), store.active, textarea?.plainText ?? "")
    if (!answer) {
      toast.show({ message: "Type or pick an answer", variant: "info" })
      return
    }
    setStore("submitting", true)
    const result = await answerWorkflowRun(sdk, {
      id: props.run.id,
      answer,
      permissionSessionID: props.sessionID,
    })
    setStore("submitting", false)
    if (result.type === "ok") {
      toast.show({ message: `Answered ${props.run.workflow}`, variant: "success" })
      props.onClose(isResumeAnswer(props.run.id, result.run) ? result.run.id : undefined)
      return
    }
    if (result.type === "not_found") toast.show({ message: "Workflow run is gone", variant: "error" })
    else if (result.type === "no_question") toast.show({ message: "This run has no open question", variant: "info" })
    else toast.show({ message: `Failed to answer: ${result.message}`, variant: "error" })
    props.onClose()
  }

  // The free-text textarea is focused on open so a custom answer (including the
  // letters j/k) can be typed. The dialog form bindings are therefore scoped to
  // the textarea target with priority 1 so they win over the global managed
  // textarea input layer (mirrors DialogWorkflowSave / DialogPrompt / the prompt
  // autocomplete). Only ↑/↓ navigate the option list — the bare k/j aliases are
  // gone (they belong to the textarea now) — and nav is enabled only when there
  // is an option to move between (shouldEnableNav), so a free-text-only question
  // leaves the arrows to the textarea cursor.
  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    priority: 1,
    bindings: [
      ...(shouldEnableNav(options())
        ? [
            { key: "up", desc: "Previous answer", group: "Dialog", cmd: () => move(-1) },
            { key: "down", desc: "Next answer", group: "Dialog", cmd: () => move(1) },
          ]
        : []),
      { key: "return", desc: "Submit answer", group: "Dialog", cmd: () => void submit() },
    ],
  }))

  onMount(() => {
    dialog.setSize("medium")
    // Focus after a tick so the textarea is mounted (mirrors DialogWorkflowSave /
    // DialogPrompt); a custom answer is then typable the moment the dialog opens.
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Workflow needs input
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onClose()}>
          esc
        </text>
      </box>
      <Show when={pending()} fallback={<text fg={theme.textMuted}>This run has no open question.</text>}>
        <box gap={1}>
          <text fg={theme.text}>{pending()!.question}</text>
          <box>
            <For each={options()}>
              {(option, index) => {
                const active = createMemo(() => index() === store.active)
                return (
                  <box
                    paddingLeft={1}
                    paddingRight={1}
                    backgroundColor={active() ? theme.primary : undefined}
                    onMouseUp={() => {
                      setStore("active", index())
                      void submit()
                    }}
                  >
                    <text fg={active() ? selectedForeground(theme) : theme.text}>
                      {option.kind === "option" ? option.label : `↳ ${option.label}`}
                    </text>
                  </box>
                )
              }}
            </For>
          </box>
          <textarea
            height={3}
            ref={(val: TextareaRenderable) => {
              textarea = val
              setTextareaTarget(val)
            }}
            placeholder="Custom answer (used when the free-text entry is selected)"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
          <text fg={theme.textMuted}>[↑/↓] Select | [Enter] Submit | [Esc] Cancel</text>
        </box>
      </Show>
    </box>
  )
}

// Promise wrapper mirroring DialogConfirm.show / DialogWorkflowApproval.show.
// Resolves to the resume run id when answering parked a run produced one, or
// undefined (answered in place / cancelled / failed).
DialogWorkflowQuestion.show = (dialog: DialogContext, input: { run: WorkflowRun; sessionID?: string }) => {
  return new Promise<string | undefined>((resolve) => {
    dialog.replace(
      () => (
        <DialogWorkflowQuestion
          run={input.run}
          sessionID={input.sessionID}
          onClose={(resumeRunID) => {
            resolve(resumeRunID)
            dialog.clear()
          }}
        />
      ),
      () => resolve(undefined),
    )
  })
}
