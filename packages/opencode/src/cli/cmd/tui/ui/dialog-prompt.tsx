import { TextareaRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { onMount, type JSX, createSignal } from "solid-js"


export type DialogPromptProps = {
  title: string
  description?: () => JSX.Element
  placeholder?: string
  value?: string
  onConfirm?: (value: string) => void
  onCancel?: () => void
}

export function DialogPrompt(props: DialogPromptProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const MIN_HEIGHT = 3
  const MAX_HEIGHT = 8
  const [inputHeight, setInputHeight] = createSignal(MIN_HEIGHT)

  let textarea: TextareaRenderable

  const syncHeight = () => {
    if (!textarea) return
    const lines = textarea.virtualLineCount ?? textarea.lineCount
    setInputHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, lines)))
  }

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      textarea.focus()
      syncHeight()
    }, 1)
    textarea.gotoLineEnd()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <box gap={1}>
        {props.description}
        <textarea
          onSubmit={() => {
            props.onConfirm?.(textarea.plainText)
          }}
          height={inputHeight()}
          minHeight={MIN_HEIGHT}
          maxHeight={MAX_HEIGHT}
          onContentChange={syncHeight}
          keyBindings={[{ name: "return", action: "submit" }]}
          ref={(val: TextareaRenderable) => {
            textarea = val
            syncHeight()
          }}
          initialValue={props.value}
          placeholder={props.placeholder ?? "Enter text"}
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.text}
        />
      </box>
      <box paddingBottom={1} gap={1} flexDirection="row">
        <text fg={theme.text}>
          enter <span style={{ fg: theme.textMuted }}>submit</span>
        </text>
      </box>
    </box>
  )
}

DialogPrompt.show = (dialog: DialogContext, title: string, options?: Omit<DialogPromptProps, "title">) => {
  return new Promise<string | null>((resolve) => {
    dialog.replace(
      () => (
        <DialogPrompt title={title} {...options} onConfirm={(value) => resolve(value)} onCancel={() => resolve(null)} />
      ),
      () => resolve(null),
    )
  })
}
