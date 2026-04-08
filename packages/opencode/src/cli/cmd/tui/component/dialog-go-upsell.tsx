import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"

const GO_URL = "https://opencode.ai/go"

export type DialogGoUpsellProps = {
  onClose?: () => void
}

export function DialogGoUpsell(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useKeyboard((evt) => {
    if (evt.name !== "return") return
    props.onClose?.()
    dialog.clear()
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Free usage limit reached
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1} paddingBottom={1}>
        <text fg={theme.textMuted}>
          Subscribe to OpenCode Go for generous and reliable access to the best open coding models starting at $5/month.
        </text>
        <box flexDirection="row" gap={1}>
          <text fg={theme.text}>Subscribe:</text>
          <Link href={GO_URL} fg={theme.primary} />
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={theme.primary}
          onMouseUp={() => {
            props.onClose?.()
            dialog.clear()
          }}
        >
          <text fg={theme.selectedListItemText}>close</text>
        </box>
      </box>
    </box>
  )
}

DialogGoUpsell.show = (dialog: DialogContext) => {
  return new Promise<void>((resolve) => {
    dialog.replace(
      () => <DialogGoUpsell onClose={() => resolve()} />,
      () => resolve(),
    )
  })
}
