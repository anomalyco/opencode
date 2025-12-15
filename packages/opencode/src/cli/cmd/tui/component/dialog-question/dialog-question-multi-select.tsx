import { createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogMultiSelect, type DialogMultiSelectOption } from "@tui/ui/dialog-multiselect"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./helpers"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionMultiSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options with recommended first
  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  onMount(() => {
    dialog.setSize("medium")
  })

  function openComment() {
    dialog.push(() => (
      <DialogQuestionComment
        question={props.item.question}
        value={comment()}
        onSave={(c) => {
          const trimmedComment = c.trim() || undefined
          setComment(trimmedComment)
          // Update just the comment, merging with existing answer
          props.onAnswer({ comment: trimmedComment })
          dialog.pop()
        }}
        onCancel={() => dialog.pop()}
      />
    ))
  }

  // Convert options to DialogMultiSelectOption format
  const selectOptions = createMemo<DialogMultiSelectOption<string>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option.value,
      footer: option.recommended ? "(Recommended)" : undefined,
    })),
  )

  // Get current values as array
  const currentValues = createMemo(() => {
    if (Array.isArray(props.currentAnswer?.value)) {
      return props.currentAnswer.value
    }
    return []
  })

  function confirmSelection(selected: string[]) {
    props.onAnswer({ value: selected })
    dialog.pop()
  }

  return (
    <DialogMultiSelect
      title={props.item.question}
      options={selectOptions()}
      current={currentValues()}
      hideSearch={true}
      onSelect={confirmSelection}
      beforeFooter={
        comment() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.textMuted}>💬 "{truncate(comment()!, 40)}"</text>
          </box>
        ) : undefined
      }
      keybind={[
        {
          keybind: { name: "c", ctrl: false, meta: false, shift: false, super: false, leader: false },
          title: "add comment",
          onTrigger: () => openComment(),
        },
      ]}
    />
  )
}
