import { createMemo, Show } from "solid-js"
import { PromptSubmissionError } from "@opencode-ai/client/solid"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { useToast } from "../../ui/toast"
import { errorMessage } from "../../util/error"

export function PromptSubmissionStatus(props: { sessionID: string; messageID: string }) {
  const data = useData()
  const theme = useTheme()
  const toast = useToast()
  const submission = createMemo(() => data.session.submission.get(props.sessionID, props.messageID))
  const act = (action: "retry" | "cancel") => {
    const request =
      action === "retry"
        ? data.session.submission.retry(props.sessionID, props.messageID)
        : data.session.pending.cancel(props.sessionID, props.messageID)
    void request.catch((error: unknown) => {
      if (error instanceof PromptSubmissionError) return
      toast.show({ title: "Prompt submission failed", message: errorMessage(error), variant: "error" })
    })
  }
  return (
    <Show when={submission()}>
      {(state) => (
        <box flexDirection="row" gap={2} flexWrap="wrap" paddingTop={1}>
          <text fg={state().status === "failed" ? theme.text.feedback.error.default : theme.text.subdued}>
            {state().status === "failed"
              ? "Send not confirmed"
              : state().status === "retrying"
                ? `Retrying send (attempt ${state().attempt + 1}/4)`
                : "Sending..."}
          </text>
          <Show when={state().status === "failed"}>
            <text
              fg={theme.text.action.primary.default}
              onMouseUp={(event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                act("retry")
              }}
            >
              retry
            </text>
          </Show>
          <text
            fg={theme.text.action.primary.default}
            onMouseUp={(event) => {
              if (event.button !== 0) return
              event.stopPropagation()
              act("cancel")
            }}
          >
            cancel
          </text>
        </box>
      )}
    </Show>
  )
}
