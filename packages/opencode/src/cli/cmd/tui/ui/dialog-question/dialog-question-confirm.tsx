import { TextAttributes } from "@opentui/core"
import { useTheme, selectedForeground } from "@tui/context/theme"
import { createMemo, createSignal, onMount, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { DialogQuestionComment } from "./dialog-question-comment"
import { truncate } from "./utils"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionConfirm(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const [selected, setSelected] = createSignal<boolean | null>(
    typeof props.currentAnswer?.value === "boolean" ? props.currentAnswer.value : null,
  )
  const [comment, setComment] = createSignal<string | undefined>(props.currentAnswer?.comment)

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

  function confirmSelection() {
    if (selected() !== null) {
      props.onAnswer({ value: selected(), comment: comment() })
    }
  }

  function submitAll() {
    if (selected() !== null) {
      props.onSubmitAll({ value: selected(), comment: comment() })
    }
  }

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.name === "left" || (evt.ctrl && evt.name === "p")) {
      setSelected(true)
      evt.preventDefault()
    }
    if (evt.name === "down" || evt.name === "right" || (evt.ctrl && evt.name === "n")) {
      setSelected(false)
      evt.preventDefault()
    }
    if (evt.name === "return" && !evt.ctrl) {
      confirmSelection()
      evt.preventDefault()
    }
    if (evt.ctrl && evt.name === "return") {
      submitAll()
      evt.preventDefault()
    }
    if (evt.name === "c" && !evt.ctrl) {
      openComment()
      evt.preventDefault()
    }
    if (evt.name === "y") {
      setSelected(true)
      evt.preventDefault()
    }
    if (evt.name === "n") {
      setSelected(false)
      evt.preventDefault()
    }
  })

  const defaultHint = createMemo(() => {
    if (typeof props.item.default === "boolean") {
      return props.item.default ? "Yes" : "No"
    }
    return undefined
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.item.question}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
        <Show when={defaultHint()}>
          <text fg={theme.textMuted}>Default: {defaultHint()}</text>
        </Show>
      </box>
      <box paddingLeft={3} paddingRight={3} flexDirection="row" gap={2}>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === true ? theme.primary : undefined}
          onMouseUp={() => {
            setSelected(true)
            confirmSelection()
          }}
        >
          <text
            fg={selected() === true ? selectedForeground(theme) : theme.text}
            attributes={selected() === true ? TextAttributes.BOLD : undefined}
          >
            Yes
          </text>
        </box>
        <box
          paddingLeft={2}
          paddingRight={2}
          backgroundColor={selected() === false ? theme.primary : undefined}
          onMouseUp={() => {
            setSelected(false)
            confirmSelection()
          }}
        >
          <text
            fg={selected() === false ? selectedForeground(theme) : theme.text}
            attributes={selected() === false ? TextAttributes.BOLD : undefined}
          >
            No
          </text>
        </box>
      </box>
      <Show when={comment()}>
        <box paddingLeft={4} paddingRight={4}>
          <text fg={theme.textMuted}>
            {"\uD83D\uDCAC"} "{truncate(comment()!, 40)}"
          </text>
        </box>
      </Show>
      <box paddingRight={2} paddingLeft={4} flexDirection="row" gap={2} flexShrink={0} paddingTop={1}>
        <text>
          <span style={{ fg: theme.text }}>
            <b>y/n</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>select</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>enter</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>confirm</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>c</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>comment</span>
        </text>
      </box>
    </box>
  )
}
