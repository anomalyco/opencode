import { useDialog } from "@tui/ui/dialog"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionText(props: SingleQuestionProps) {
  const dialog = useDialog()
  const placeholder = typeof props.item.default === "string" ? props.item.default : "Enter your response..."
  const initialValue = typeof props.currentAnswer?.value === "string" ? props.currentAnswer.value : ""

  function confirmText(value: string) {
    const trimmedValue = value.trim()
    props.onAnswer({ value: trimmedValue || null })
    dialog.pop()
  }

  return (
    <DialogPrompt
      title={props.item.question}
      placeholder={placeholder}
      value={initialValue}
      onConfirm={confirmText}
      onCancel={() => props.onCancel()}
    />
  )
}
