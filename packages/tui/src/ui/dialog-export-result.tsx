import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog, type DialogContext } from "./dialog"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Close export result",
        group: "Dialog",
        cmd: close,
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Session exported
        </text>
        <text fg={theme.textMuted} onMouseUp={close}>
          esc
        </text>
      </box>
      <box>
        <text fg={theme.text}>{props.path}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.primary}
          onMouseUp={close}
        >
          <text fg={theme.selectedListItemText}>Close</text>
        </box>
      </box>
    </box>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })
