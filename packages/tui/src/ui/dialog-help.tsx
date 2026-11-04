import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"

export function DialogHelp() {
  const dialog = useDialog()
  const theme = useTheme().surface("dialog")
  const shortcuts = Keymap.useShortcuts()

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close help", group: "Dialog", run: () => dialog.clear() },
      { bind: "escape", title: "Close help", group: "Dialog", run: () => dialog.clear() },
    ],
  }))

  return (
    <DialogLayout
      header={<DialogHeader title="Help" closeLabel="esc/enter" />}
      footer={{ actions: { primary: [{ title: "ok", key: "enter", onTrigger: () => dialog.clear() }] } }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <box
            paddingLeft={3}
            paddingRight={3}
            backgroundColor={theme.background.action.primary.focused}
            onMouseUp={() => dialog.clear()}
          >
            <text fg={theme.text.action.primary.focused}>ok</text>
          </box>
        </box>
      }
    >
      <text fg={theme.text.muted}>
        Press {shortcuts.get("command.palette.show")} to see all available actions and commands in any context.
      </text>
    </DialogLayout>
  )
}
