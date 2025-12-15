import { useTheme } from "@tui/context/theme"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./utils"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionSelect(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

  const sortedOptions = createMemo(() => {
    const opts = props.item.options ?? []
    return [...opts].sort((a, b) => (b.recommended ? 1 : 0) - (a.recommended ? 1 : 0))
  })

  const currentValue = createMemo(() => props.currentAnswer?.value)

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

  function confirmSelection(option: { value: string; label: string; recommended?: boolean }) {
    props.onAnswer({ value: option.value, comment: comment() })
  }

  function submitAll(option: { value: string; label: string; recommended?: boolean }) {
    props.onSubmitAll({ value: option.value, comment: comment() })
  }

  const selectOptions = createMemo<DialogSelectOption<{ value: string; label: string; recommended?: boolean }>[]>(() =>
    sortedOptions().map((option) => ({
      title: option.label,
      value: option,
      footer: option.recommended ? "(Recommended)" : undefined,
      onSelect: () => confirmSelection(option),
    })),
  )

  const defaultHint = createMemo(() => {
    if (typeof props.item.default === "string") {
      const opt = props.item.options?.find((o) => o.value === props.item.default)
      return opt?.label
    }
    return undefined
  })

  return (
    <>
      <Show when={defaultHint()}>
        <box paddingLeft={4} paddingRight={4} paddingTop={1}>
          <text fg={theme.textMuted}>Default: {defaultHint()}</text>
        </box>
      </Show>
      <DialogSelect
        title={props.item.question}
        options={selectOptions()}
        current={sortedOptions().find((o) => o.value === currentValue())}
        hideSearch={true}
        keybind={[
          {
            keybind: { name: "m", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "add comment",
            onTrigger: () => openComment(),
          },
          {
            keybind: { name: "s", ctrl: false, meta: false, shift: false, super: false, leader: false },
            title: "submit all",
            onTrigger: (option) => submitAll(option.value),
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
