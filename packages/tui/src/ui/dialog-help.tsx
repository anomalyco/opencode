import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { useLanguage } from "../context/language"

export function DialogHelp() {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme("elevated")
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
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {language.t("sidebar.help")}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.text.subdued}>
          {language.t("tui.dialogs.helpDescription", { key: shortcuts.get("command.palette.show") ?? "" })}
        </text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.background.action.primary.focused}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={theme.text.action.primary.focused}>{language.t("tui.dialogs.ok")}</text>
        </box>
      </box>
    </box>
  )
}
