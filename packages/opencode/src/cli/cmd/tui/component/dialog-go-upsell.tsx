import { RGBA, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import open from "open"
import { createSignal } from "solid-js"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"

const GO_URL = "https://opencode.ai/go"

export type DialogGoUpsellProps = {
  onClose?: (dontShowAgain?: boolean) => void
}

function subscribe(props: DialogGoUpsellProps, dialog: ReturnType<typeof useDialog>) {
  open(GO_URL).catch(() => {})
  props.onClose?.()
  dialog.clear()
}

function dismiss(props: DialogGoUpsellProps, dialog: ReturnType<typeof useDialog>) {
  props.onClose?.(true)
  dialog.clear()
}

export function DialogGoUpsell(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const [selected, setSelected] = createSignal(0)

  useKeyboard((evt) => {
    if (evt.name === "left" || evt.name === "right" || evt.name === "tab") {
      setSelected((s) => (s === 0 ? 1 : 0))
      return
    }
    if (evt.name !== "return") return
    if (selected() === 0) subscribe(props, dialog)
    else dismiss(props, dialog)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Free limit reached
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1} paddingBottom={1}>
        <text fg={theme.textMuted}>
          Subscribe to OpenCode Go to keep going with reliable access to the best open-source models, starting at
          $5/month.
        </text>
        <box flexDirection="row" gap={1}>
          <Link href={GO_URL} fg={theme.primary} />
        </box>
      </box>
      <box flexDirection="row" justifyContent="flex-end" gap={1} paddingBottom={1}>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={selected() === 0 ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
          onMouseOver={() => setSelected(0)}
          onMouseUp={() => subscribe(props, dialog)}
        >
          <text fg={selected() === 0 ? fg : theme.text} attributes={selected() === 0 ? TextAttributes.BOLD : undefined}>
            subscribe
          </text>
        </box>
        <box
          paddingLeft={3}
          paddingRight={3}
          backgroundColor={selected() === 1 ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
          onMouseOver={() => setSelected(1)}
          onMouseUp={() => dismiss(props, dialog)}
        >
          <text
            fg={selected() === 1 ? fg : theme.textMuted}
            attributes={selected() === 1 ? TextAttributes.BOLD : undefined}
          >
            don't show again
          </text>
        </box>
      </box>
    </box>
  )
}

DialogGoUpsell.show = (dialog: DialogContext) => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => <DialogGoUpsell onClose={(dontShow) => resolve(dontShow ?? false)} />,
      () => resolve(false),
    )
  })
}
