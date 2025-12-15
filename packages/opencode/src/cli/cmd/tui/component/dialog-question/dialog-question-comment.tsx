import { useTheme } from "@tui/context/theme"
import { DialogPrompt } from "@tui/ui/dialog-prompt"

interface DialogQuestionCommentProps {
  question: string
  value?: string
  onSave: (comment: string) => void
  onCancel: () => void
}

export function DialogQuestionComment(props: DialogQuestionCommentProps) {
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.question}
      description={() => <text fg={theme.textMuted}>Add comment</text>}
      placeholder="Optional comment..."
      value={props.value}
      onConfirm={(value) => props.onSave(value)}
      onCancel={() => props.onCancel()}
    />
  )
}
