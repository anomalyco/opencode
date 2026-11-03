import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"

import { useLanguage } from "../context/language"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert(props: DialogAlertProps) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")

  const confirm = () => {
    props.onConfirm?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.dialogs.confirmAlert"),
        group: language.t("tui.dialog"),
        run: confirm,
      },
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{ actions: { primary: [{ title: language.t("tui.dialogs.ok"), key: "enter", onTrigger: confirm }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={confirm}
          >
            <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.ok")}</text>
          </box>
        </box>
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
