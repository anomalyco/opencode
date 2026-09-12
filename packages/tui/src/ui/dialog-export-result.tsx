import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { useLanguage } from "../context/language"

export function DialogExportResult(props: { path: string; onClose?: () => void }) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme("elevated")

  const close = () => {
    props.onClose?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.dialogs.closeExportResult"),
        group: language.t("tui.dialog"),
        run: close,
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {language.t("tui.dialogs.sessionExported")}
        </text>
        <text fg={theme.text.subdued} onMouseUp={close}>
          esc
        </text>
      </box>
      <box>
        <text fg={theme.text.default}>{props.path}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.background.action.primary.focused}
          onMouseUp={close}
        >
          <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.close")}</text>
        </box>
      </box>
    </box>
  )
}

DialogExportResult.show = (dialog: DialogContext, path: string) =>
  new Promise<void>((resolve) => {
    dialog.replace(() => <DialogExportResult path={path} onClose={resolve} />, resolve)
  })
