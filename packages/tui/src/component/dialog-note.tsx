import { TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"
import { useLocal } from "../context/local"
import { useTheme } from "../context/theme"
import { useDialog, useDialogLayerActive } from "../ui/dialog"
import { useBindings } from "../keymap"

export function DialogNote(props: { model: { providerID: string; modelID: string }; title?: string }) {
  const local = useLocal()
  const dialog = useDialog()
  const dialogActive = useDialogLayerActive()
  const { theme } = useTheme()
  const [text, setText] = createSignal(local.model.note(props.model))

  useBindings(() => ({
    enabled: () => dialogActive(),
    bindings: [
      {
        key: "return",
        desc: "Save note",
        group: "Dialog",
        cmd: () => {
          local.model.setNote(props.model, text())
          dialog.pop()
        },
      },
    ],
  }))

  return (
    <box paddingLeft={4} paddingRight={4} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title ?? "Note"}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.pop()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>
        {props.model.providerID}/{props.model.modelID}
      </text>
      <input
        onInput={setText}
        value={text()}
        focusedBackgroundColor={theme.backgroundPanel}
        cursorColor={theme.primary}
        focusedTextColor={theme.text}
        ref={(r) => {
          setTimeout(() => {
            if (r.isDestroyed) return
            r.focus()
          }, 1)
        }}
        placeholder="Add a note (empty clears)"
        placeholderColor={theme.textMuted}
      />
      <text fg={theme.textMuted}>enter save · esc cancel</text>
    </box>
  )
}
