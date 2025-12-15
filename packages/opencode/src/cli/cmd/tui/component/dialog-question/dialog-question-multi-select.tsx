import { createEffect, createMemo, createSignal, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./helpers"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionMultiSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [checked, setChecked] = createStore<Record<string, boolean>>({})
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  // Sort options with recommended first
  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  // Initialize checked state from current answer
  createEffect(() => {
    if (Array.isArray(props.currentAnswer?.value)) {
      for (const v of props.currentAnswer.value) {
        setChecked(v, true)
      }
    }
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

  function getSelectedValues(): string[] {
    return sortedOptions()
      .filter((o) => checked[o.value])
      .map((o) => o.value)
  }

  function confirmSelection() {
    props.onAnswer({ value: getSelectedValues() })
    dialog.pop()
  }

  // Convert options to DialogSelectOption format
  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: checked[option.value] ? "☑" : "☐",
      onSelect: () => {}, // Don't close on select
    })),
  )

  return (
    <DialogSelect
      title={props.item.question}
      options={selectOptions()}
      hideSearch={true}
      onSelect={() => confirmSelection()}
      beforeFooter={
        comment() ? (
          <box paddingLeft={4} paddingRight={4}>
            <text fg={theme.textMuted}>💬 "{truncate(comment()!, 40)}"</text>
          </box>
        ) : undefined
      }
      keybind={[
        {
          keybind: { name: "space", ctrl: false, meta: false, shift: false, super: false, leader: false },
          title: "toggle",
          onTrigger: (option) => setChecked(option.value.value, !checked[option.value.value]),
        },
        {
          keybind: { name: "c", ctrl: false, meta: false, shift: false, super: false, leader: false },
          title: "add comment",
          onTrigger: () => openComment(),
        },
      ]}
    />
  )
}
