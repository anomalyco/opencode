import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"

import { useLanguage } from "../context/language"

export function DialogHelp() {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.dialogs.closeHelp"),
        group: language.t("tui.dialog"),
        run: () => dialog.clear(),
      },
      {
        bind: "escape",
        title: language.t("tui.dialogs.closeHelp"),
        group: language.t("tui.dialog"),
        run: () => dialog.clear(),
      },
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title={language.t("sidebar.help")} closeLabel="esc/enter" />}
      footer={{
        actions: { primary: [{ title: language.t("tui.dialogs.ok"), key: "enter", onTrigger: () => dialog.clear() }] },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.ok")}</text>
          </box>
        </box>
      }
    >
      <text fg={theme.text.muted}>
        {language.t("tui.help.allCommands", { shortcut: shortcuts.get("command.palette.show") ?? "" })}
      </text>
    </DialogLayout>
  )
}
