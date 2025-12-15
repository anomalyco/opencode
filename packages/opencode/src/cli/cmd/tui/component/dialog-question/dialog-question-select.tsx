import { createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./helpers"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options with recommended first
  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  // Find current selection value
  const currentValue = createMemo(() => props.currentAnswer?.value)

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

  function confirmSelection(option: { value: string; label: string; recommended?: boolean }) {
    props.onAnswer({ value: option.value })
    dialog.pop()
  }

  // Convert options to DialogSelectOption format
  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: option.recommended ? "(Recommended)" : undefined,
    })),
  )

  return (
    <DialogSelect
      title={props.item.question}
      options={selectOptions()}
      current={sortedOptions().find((o) => o.value === currentValue())}
      hideSearch={true}
      onSelect={(option) => confirmSelection(option.value)}
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
