import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { createMemo, onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import type { SingleQuestionProps } from "./types"

export function DialogQuestionText(props: SingleQuestionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      textarea.focus()
    }, 1)
  })

  function confirmText() {
    const value = textarea.plainText.trim()
    props.onAnswer({ value: value || null })
  }

  function submitAll() {
    const value = textarea.plainText.trim()
    props.onSubmitAll({ value: value || null })
  }

  useKeyboard((evt) => {
    if (evt.ctrl && evt.name === "return") {
      submitAll()
      evt.preventDefault()
    }
  })

  const placeholder = createMemo(() => {
    if (typeof props.item.default === "string") {
      return props.item.default
    }
    return "Enter your response..."
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.item.question}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        <textarea
          onSubmit={confirmText}
          height={5}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={typeof props.currentAnswer?.value === "string" ? props.currentAnswer.value : ""}
          placeholder={placeholder()}
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
          <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
        <text>
          <span style={{ fg: theme.text }}>
            <b>ctrl+enter</b>{" "}
          </span>
          <span style={{ fg: theme.textMuted }}>submit all</span>
        </text>
      </box>
    </box>
  )
}
