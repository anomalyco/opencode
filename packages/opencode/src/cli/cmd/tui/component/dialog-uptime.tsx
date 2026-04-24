import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { useDialog } from "@tui/ui/dialog"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { processStartTime } from "@/util/opencode-process"

function formatDuration(ms: number) {
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return "<1m"
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  return [
    ...(days > 0 ? [`${days}d`] : []),
    ...(hours > 0 ? [`${hours}h`] : []),
    ...(minutes > 0 ? [`${minutes}m`] : []),
  ].join(" ")
}

export function DialogUptime() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const sync = useSync()

  const now = Date.now()
  const time = new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  const uptime = formatDuration(now - processStartTime())

  const suffix = () => {
    if (route.data.type !== "session") return ""
    const sessionID = route.data.sessionID
    const session = sync.session.get(sessionID)
    const messages = sync.data.message[sessionID] ?? []
    const last = messages.at(-1)
    if (!last) return session ? `, idle ${formatDuration(now - session.time.created)}` : ""
    if (last.role === "user") return ", working"
    if (!last.time.completed) return ", working"
    return `, idle ${formatDuration(now - last.time.completed)}`
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Uptime
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text}>
        {time} &nbsp;up {uptime}
        {suffix()}
      </text>
    </box>
  )
}
