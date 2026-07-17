import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Close export result",
        group: "Dialog",
        run: close,
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          Session exported
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={close}>
          esc
        </text>
      </box>
      <box>
        <text fg={themeV2.text()}>{props.path}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={themeV2.background.action("focused")} onMouseUp={close}>
          <text fg={themeV2.text.action("focused")}>Close</text>
        </box>
      </box>
    </box>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })
