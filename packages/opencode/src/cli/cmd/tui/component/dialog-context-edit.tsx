import { TextAttributes, TextareaRenderable } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"

export function DialogContextEdit(props: { name: string; content: string; onConfirm: (content: string) => void }) {
  const dialog = useDialog()
  const toast = useToast()
  const { theme } = useTheme()
  const [value, setValue] = createSignal(props.content)
  let textarea: TextareaRenderable | undefined

  onMount(() => {
    textarea?.focus()
    textarea?.gotoLineEnd()
  })

  const submit = () => {
    props.onConfirm(value().trim())
    toast.show({ variant: "success", message: `Updated ${props.name}` })
    dialog.clear()
  }

  return (
    <box flexDirection="column" gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text attributes={TextAttributes.BOLD}>Edit Context: {props.name}</text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <text fg={theme.textMuted} wrapMode="word">
        Large editor (non-VIM). Shift+Enter for newline, Ctrl+Enter to save.
      </text>
      <textarea
        ref={(node) => {
          textarea = node
        }}
        initialValue={value()}
        minHeight={10}
        maxHeight={20}
        keyBindings={[{ name: "ctrl+enter", action: "submit" }]}
        onSubmit={() => submit()}
      />

      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <text fg={theme.error} onMouseUp={() => dialog.clear()}>
          Cancel
        </text>
        <text fg={theme.accent} attributes={TextAttributes.BOLD} onMouseUp={submit}>
          Save
        </text>
      </box>
    </box>
  )
}
