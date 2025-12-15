import { useTheme } from "@tui/context/theme"
import { createEffect, createMemo, createSignal, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./utils"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionMultiSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [checked, setChecked] = createStore<Record<string, boolean>>({})
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

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
        value={comment()}
        onSave={(c) => {
          setComment(c)
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
    props.onAnswer({ value: getSelectedValues(), comment: comment() })
  }

  function submitAll() {
    props.onSubmitAll({ value: getSelectedValues(), comment: comment() })
  }

  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: checked[option.value] ? "☑" : "☐",
      onSelect: () => {},
    })),
  )

  const selectedCount = createMemo(() => getSelectedValues().length)

  return (
    <>
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>{selectedCount()} selected</text>
      </box>
      <DialogSelect
        title={props.item.question}
        options={selectOptions()}
        hideSearch={true}
        onSelect={() => confirmSelection()}
        keybind={[
          {
            keybind: { name: "space", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "toggle",
            onTrigger: (option) => setChecked(option.value.value, !checked[option.value.value]),
          },
          {
            keybind: { name: "m", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "add comment",
            onTrigger: () => openComment(),
          },
          {
            keybind: { name: "s", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "submit all",
            onTrigger: () => submitAll(),
          },
        ]}
      />
      <Show when={comment()}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>💬 "{truncate(comment()!, 40)}"</text>
        </box>
      </Show>
    </>
  )
}
