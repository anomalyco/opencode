import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { i18n } from "../i18n"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"

export type DialogAlertProps = {
  title: string
  message: string
  onConfirm?: () => void
}

export function DialogAlert(props: DialogAlertProps) {
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
        title: i18n.t("dialog.alert.confirm"),
        group: i18n.t("dialog.group"),
        run: confirm,
      },
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{ actions: { primary: [{ title: i18n.t("dialog.alert.ok"), key: "enter", onTrigger: confirm }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={confirm}
          >
            <text fg={theme.text.action.primary.focused}>{i18n.t("dialog.alert.ok")}</text>
          </box>
        </box>
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
