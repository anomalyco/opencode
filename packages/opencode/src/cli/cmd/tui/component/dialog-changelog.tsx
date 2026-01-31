import { useDialog } from "@tui/ui/dialog"
import { useTheme } from "@tui/context/theme"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"

export type DialogChangelogProps = {
  version: string
  notes: string
}

export function DialogChangelog(props: DialogChangelogProps) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()

  useKeyboard((evt) => {
    if (evt.name === "return" || evt.name === "escape") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Changelog {props.version !== "local" ? `v${props.version}` : "(local)"}
        </text>
        <text fg={theme.textMuted}>esc/enter</text>
      </box>
      <scrollbox height={20} paddingBottom={1}>
        <code
          filetype="markdown"
          drawUnstyledText={false}
          syntaxStyle={syntax()}
          content={props.notes}
          fg={theme.text}
        />
      </scrollbox>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary} onMouseUp={() => dialog.clear()}>
          <text fg={theme.selectedListItemText}>close</text>
        </box>
      </box>
    </box>
  )
}
