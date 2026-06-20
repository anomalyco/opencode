import { createMemo, onMount } from "solid-js"
import type { Session, SessionStatus } from "@opencode-ai/sdk/v2"
import { useRoute, useRouteData } from "../../context/route"
import { useSync } from "../../context/sync"
import { useTheme, type Theme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { Locale } from "../../util/locale"

type TreeSession = Session & {
  depth: number
}

function statusIcon(status: SessionStatus | undefined, pending: number) {
  if (pending > 0) return "!"
  if (status?.type === "busy") return "*"
  if (status?.type === "retry") return "!"
  return " "
}

function statusColor(status: SessionStatus | undefined, pending: number, theme: Theme) {
  if (pending > 0) return theme.warning
  if (status?.type === "busy") return theme.primary
  if (status?.type === "retry") return theme.error
  return theme.textMuted
}

function statusLabel(status: SessionStatus | undefined) {
  if (!status) return "idle"
  if (status.type === "retry") return `retry ${status.attempt}`
  return status.type
}

export function DialogSessionTree() {
  const dialog = useDialog()
  const route = useRouteData("session")
  const nav = useRoute()
  const sync = useSync()
  const { theme } = useTheme()

  onMount(() => {
    dialog.setSize("large")
  })

  const sortSessions = (a: Session, b: Session) => a.time.created - b.time.created || a.id.localeCompare(b.id)
  const rootSession = createMemo(() => {
    const root = (current: Session): Session => {
      if (!current.parentID) return current
      return root(sync.session.get(current.parentID) ?? current)
    }
    const current = sync.session.get(route.sessionID)
    if (!current) return
    return root(current)
  })
  const options = createMemo((): DialogSelectOption<string>[] => {
    const root = rootSession()
    if (!root) return []

    const collect = (session: Session, depth: number): TreeSession[] => [
      { ...session, depth },
      ...sync.data.session
        .filter((item) => item.parentID === session.id)
        .toSorted(sortSessions)
        .flatMap((child) => collect(child, depth + 1)),
    ]

    return collect(root, 0).map((session) => {
      const status = sync.data.session_status[session.id]
      const pending = (sync.data.permission[session.id]?.length ?? 0) + (sync.data.question[session.id]?.length ?? 0)
      const current = session.id === route.sessionID
      return {
        title: `${"  ".repeat(session.depth)}${current ? "> " : ""}${session.title}`,
        value: session.id,
        category: session.depth === 0 ? "Root" : "Subagents",
        footer: [
          session.agent ? `@${session.agent}` : undefined,
          statusLabel(status),
          pending > 0 ? `${pending} pending` : undefined,
          Locale.time(session.time.updated),
        ]
          .filter((item) => item !== undefined)
          .join(" | "),
        gutter: () => <text fg={statusColor(status, pending, theme)}>{statusIcon(status, pending)}</text>,
      }
    })
  })

  return (
    <DialogSelect
      title="Session tree"
      options={options()}
      current={route.sessionID}
      onSelect={(option) => {
        nav.navigate({ type: "session", sessionID: option.value })
        dialog.clear()
      }}
    />
  )
}
