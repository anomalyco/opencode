import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"

interface DialogQuestionCommentProps {
  value?: string
  onSave: (comment: string) => void
  onCancel: () => void
}

export function DialogQuestionComment(props: DialogQuestionCommentProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      textarea.focus()
      textarea.gotoLineEnd()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Add Comment
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <text fg={theme.textMuted}>Add additional context to your answer:</text>
        <textarea
          onSubmit={() => props.onSave(textarea.plainText)}
          height={4}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.value ?? ""}
          placeholder="Optional comment..."
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text>
          <span style={{ fg: theme.text }}>
            <b>enter</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>save</span>
        </text>
      </box>
    </box>
  )
}
