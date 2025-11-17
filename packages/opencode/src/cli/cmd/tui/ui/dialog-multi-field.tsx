import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { onMount, createSignal, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"

export type DialogMultiFieldProps = {
  title: string
  fields: Array<{
    name: string
    label: string
    placeholder?: string
    value?: string
    required?: boolean
  }>
  onConfirm?: (values: Record<string, string>) => void
  onCancel?: () => void
}

export function DialogMultiField(props: DialogMultiFieldProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const textareas: Record<string, TextareaRenderable> = {}
  const [focusedIndex, setFocusedIndex] = createSignal(0)

  const focusField = (fieldName: string) => {
    const target = textareas[fieldName]
    if (!target) return
    const idx = props.fields.findIndex((field) => field.name === fieldName)
    if (idx >= 0) setFocusedIndex(idx)
    try {
      target.focus()
      target.gotoLineEnd()
    } catch (error) {
      console.warn("[DialogMultiField] Failed to focus field", error)
    }
  }

  useKeyboard((evt) => {
    // Tab: move to next field
    if (evt.name === "tab" && !evt.shift) {
      const nextIndex = (focusedIndex() + 1) % props.fields.length
      setFocusedIndex(nextIndex)
      const nextField = props.fields[nextIndex]
      focusField(nextField.name)
      return
    }

    // Shift+Tab: move to previous field
    if (evt.name === "tab" && evt.shift) {
      const prevIndex = (focusedIndex() - 1 + props.fields.length) % props.fields.length
      setFocusedIndex(prevIndex)
      const prevField = props.fields[prevIndex]
      focusField(prevField.name)
      return
    }

    // Enter: submit form
    if (evt.name === "return" && evt.ctrl) {
      const values: Record<string, string> = {}
      for (const field of props.fields) {
        values[field.name] = textareas[field.name]?.plainText || ""
      }
      props.onConfirm?.(values)
      dialog.clear()
    }
  })

  onMount(() => {
    dialog.setSize("large")
    setTimeout(() => {
      const firstField = props.fields[0]
      if (firstField) focusField(firstField.name)
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD}>{props.title}</text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <For each={props.fields}>
        {(field, index) => {
          const isFocused = () => focusedIndex() === index()
          return (
            <box gap={0}>
              <text fg={theme.text}>
                {field.label}
                {field.required && <span style={{ fg: theme.error }}> *</span>}
                {isFocused() && <span style={{ fg: theme.accent }}> ← focused</span>}
              </text>
              <box>
                <textarea
                  ref={(val: TextareaRenderable) => {
                    textareas[field.name] = val
                  }}
                  initialValue={field.value || ""}
                  placeholder={field.placeholder || ""}
                  onMouseUp={() => setFocusedIndex(index())}
                />
              </box>
            </box>
          )
        }}
      </For>

      <box paddingBottom={1}>
        <text fg={theme.textMuted}>Tab/Shift+Tab: navigate | Ctrl+Enter: submit | Esc: cancel</text>
      </box>
    </box>
  )
}
