import { createMemo, createSignal, onMount } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./helpers"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionConfirm(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

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

  function confirmSelection(value: boolean) {
    props.onAnswer({ value })
    dialog.pop()
  }

  // Yes/No options
  const options = createMemo<DialogSelectOption<boolean>[]>(() => [
    {
      title: "Yes",
      value: true,
      onSelect: () => confirmSelection(true),
    },
    {
      title: "No",
      value: false,
      onSelect: () => confirmSelection(false),
    },
  ])

  return (
    <DialogSelect
      title={props.item.question}
      options={options()}
      current={typeof currentValue() === "boolean" ? currentValue() : undefined}
      hideSearch={true}
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
