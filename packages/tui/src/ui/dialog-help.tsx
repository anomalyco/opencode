import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"

export function DialogHelp() {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")
  const shortcuts = Keymap.useShortcuts()

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Close help", group: "Dialog", run: () => dialog.clear() },
      { bind: "escape", title: "Close help", group: "Dialog", run: () => dialog.clear() },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          Help
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc/enter
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={themeV2.text.subdued()}>
          Press {shortcuts.get("command.palette.show")} to see all available actions and commands in any context.
        </text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={themeV2.background.action("focused")}
          onMouseUp={() => dialog.clear()}
        >
          <text fg={themeV2.text.action("focused")}>ok</text>
        </box>
      </box>
    </box>
  )
}
