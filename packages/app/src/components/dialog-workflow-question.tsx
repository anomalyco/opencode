import { Component, createMemo, createSignal, For, Show } from "solid-js"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import type { WorkflowRun } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { answerWorkflowRun, questionOptions, selectedAnswer } from "./dialog-workflow-client"

// Surfaces a run's pending_question: the question text, the declared options as a
// selectable list, and a free-text field (always available). On submit it calls
// workflow.answer and, on success, follows the resumed run (refetch the
// dashboard list). Mirrors the TUI dialog-workflow-question.tsx.
const DialogWorkflowQuestion: Component<{ run: WorkflowRun; onResolved?: () => void }> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const question = props.run.pending_question
  const options = createMemo(() => (question ? questionOptions(question) : []))
  const [selected, setSelected] = createSignal(0)
  const [freetext, setFreetext] = createSignal("")
  const [pending, setPending] = createSignal(false)

  const submit = async () => {
    const answer = selectedAnswer(options(), selected(), freetext())
    if (answer === undefined || pending()) return
    setPending(true)
    const result = await answerWorkflowRun(sdk(), { id: props.run.id, answer })
    setPending(false)
    if (result.type === "ok") {
      props.onResolved?.()
      dialog.close()
      return
    }
    if (result.type === "not_found") {
      showToast({
        variant: "error",
        title: language.t("toast.workflow.answer.failed.title"),
        description: language.t("toast.workflow.answer.notFound.description"),
      })
      return
    }
    if (result.type === "no_question") {
      showToast({
        variant: "error",
        title: language.t("toast.workflow.answer.failed.title"),
        description: language.t("toast.workflow.answer.noQuestion.description"),
      })
      return
    }
    showToast({
      variant: "error",
      title: language.t("toast.workflow.answer.failed.title"),
      description: result.message,
    })
  }

  return (
    <Dialog title={language.t("dialog.workflow.question.title")} description={question?.question}>
      <div class="flex flex-col gap-3 px-1">
        <Show when={options().length > 1}>
          <div class="flex flex-col gap-0.5">
            <For each={options()}>
              {(option, index) => (
                <Show when={option.kind === "option"}>
                  <button
                    class="w-full text-left rounded-md px-2 py-1 text-14-regular"
                    classList={{
                      "bg-surface-raised-base-hover text-text-strong": selected() === index(),
                      "text-text-weak": selected() !== index(),
                    }}
                    onClick={() => setSelected(index())}
                  >
                    {option.label}
                  </button>
                </Show>
              )}
            </For>
          </div>
        </Show>
        <TextField
          autofocus
          placeholder={language.t("dialog.workflow.question.placeholder")}
          value={freetext()}
          onChange={(value) => {
            setFreetext(value)
            // Typing selects the free-text sentinel (always the last entry).
            setSelected(options().length - 1)
          }}
        />
        <div class="flex items-center justify-end">
          <Button variant="primary" disabled={pending()} onClick={() => void submit()}>
            {language.t("dialog.workflow.action.answer")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// Opens the question dialog for a run. `onResolved` refetches the dashboard once
// the answer lands (the resumed run shows up on the next list fetch).
export function openWorkflowQuestion(dialog: ReturnType<typeof useDialog>, run: WorkflowRun, onResolved?: () => void) {
  dialog.show(() => DialogWorkflowQuestion({ run, onResolved }))
}
