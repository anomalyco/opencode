import { TextAttributes } from "@opentui/core"
import { useTheme } from "../../context/theme"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { useBindings } from "../../keymap"
import { hourMinuteSecond } from "../../util/timestamps"

export type DialogTimestampProps = {
  created: number
}

// Seconds-precision datetime for the popup. The gutter renders fixed HH:MM
// because alignment matters there; the popup is where users come for precision
// (debugging, auditing, distinguishing messages sent close together — see
// opencode#20406). 24-hour formatting matches the gutter and side-steps
// opencode#28804 (Bun ignoring system locale → spurious AM/PM on Linux).
function preciseDateTime(input: number): string {
  const date = new Date(input)
  const localDate = date.toLocaleDateString()
  return `${hourMinuteSecond(input)} · ${localDate}`
}

function relative(input: number, now: number): string {
  const delta = Math.max(0, now - input)
  if (delta < 60_000) return "just now"
  if (delta < 3_600_000) {
    const minutes = Math.floor(delta / 60_000)
    return `${minutes}m ago`
  }
  if (delta < 86_400_000) {
    const hours = Math.floor(delta / 3_600_000)
    return `${hours}h ago`
  }
  const days = Math.floor(delta / 86_400_000)
  return `${days}d ago`
}

export function DialogTimestamp(props: DialogTimestampProps) {
  const dialog = useDialog()
  const { theme } = useTheme()

  useBindings(() => ({
    bindings: [
      {
        key: "return",
        desc: "Close",
        group: "Dialog",
        cmd: () => dialog.clear(),
      },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Message sent
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1} gap={1}>
        <text fg={theme.text}>{preciseDateTime(props.created)}</text>
        <text fg={theme.textMuted}>{relative(props.created, Date.now())}</text>
      </box>
    </box>
  )
}

DialogTimestamp.show = (dialog: DialogContext, created: number) => {
  dialog.replace(() => <DialogTimestamp created={created} />)
}
