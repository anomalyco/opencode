import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onMount, createSignal } from "solid-js"
import { useKeyboard } from "@opentui/solid"

const PREVIEW_MAX_LENGTH = 100
const TEXTAREA_HEIGHT = 8

export type DialogOptimizeProps = {
  original: string
  optimized: string
  onConfirm: (value: string) => void
  onCancel: () => void
}

export function DialogOptimize(props: DialogOptimizeProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  let textarea: TextareaRenderable

  const [value, setValue] = createSignal(props.optimized)

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      props.onCancel()
    }
  })

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Optimize Prompt
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onCancel()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <text fg={theme.textMuted}>Original:</text>
        <box paddingLeft={1} paddingTop={1} paddingBottom={1}>
          <text fg={theme.textMuted}>
            {props.original.slice(0, PREVIEW_MAX_LENGTH)}
            {props.original.length > PREVIEW_MAX_LENGTH ? "..." : ""}
          </text>
        </box>
        <text fg={theme.text}>Optimized (editable):</text>
        <textarea
          onSubmit={() => {
            props.onConfirm(value())
          }}
          height={TEXTAREA_HEIGHT}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => (textarea = val)}
          initialValue={props.optimized}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
          onContentChange={() => setValue(textarea?.plainText ?? "")}
        />
      </box>
      <box paddingBottom={1} gap={2} flexDirection="row">
        <box onMouseUp={() => props.onCancel()}>
          <text fg={theme.textMuted}>esc cancel</text>
        </box>
        <box onMouseUp={() => props.onConfirm(value())}>
          <text fg={theme.primary}>enter confirm</text>
        </box>
      </box>
    </box>
  )
}

DialogOptimize.show = (
  dialog: DialogContext,
  options: { original: string; optimized: string },
): Promise<string | null> => {
  return new Promise((resolve) => {
    let resolved = false
    dialog.replace(
      () => (
        <DialogOptimize
          original={options.original}
          optimized={options.optimized}
          onConfirm={(value) => {
            if (resolved) return
            resolved = true
            dialog.clear()
            resolve(value)
          }}
          onCancel={() => {
            if (resolved) return
            resolved = true
            dialog.clear()
            resolve(null)
          }}
        />
      ),
      () => {
        if (resolved) return
        resolved = true
        resolve(null)
      },
    )
  })
}
