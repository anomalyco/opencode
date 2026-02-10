import type { DialogContext } from "@tui/ui/dialog"
import { DialogSelect } from "@tui/ui/dialog-select"
import { useRoute } from "@tui/context/route"
import { useSync } from "@tui/context/sync"
import { createMemo } from "solid-js"
import { buildSessionTree } from "../../lib/session-tree"

export function DialogSubagent(props: { sessionID: string }) {
  const route = useRoute()
  const sync = useSync()

  const currentID = createMemo(() => {
    if (route.data.type !== "session") return undefined
    return route.data.sessionID
  })

  const session = createMemo(() => sync.session.get(props.sessionID))
  const status = createMemo(() => {
    const s = sync.data.session_status?.[props.sessionID] as { type?: string } | undefined
    if (s?.type === "busy" || s?.type === "retry") return "working"
    if (s?.type === "waiting") return "waiting"
    return "idle"
  })

  const name = createMemo(() => {
    const s = session()
    if (!s?.title) return "Subagent Session"
    if (s.title.startsWith("Subagent - ")) return s.title.slice(11)
    return s.title
  })

  const shortId = createMemo(() => props.sessionID.slice(-4))

  const title = createMemo(() => {
    const statusIcon = status() === "working" ? "◐" : status() === "waiting" ? "◎" : "✓"
    return `${statusIcon} ${name()}#${shortId()}`
  })

  const parentID = createMemo(() => session()?.parentID)

  const rootID = createMemo(() => {
    const parent = parentID()
    if (!parent) return undefined

    return buildSessionTree({
      currentSessionID: props.sessionID,
      sessions: sync.data.session,
      sort: "created",
    }).rootID
  })

  const showRoot = createMemo(() => {
    const root = rootID()
    if (!root) return false

    const parent = parentID()
    if (!parent) return false
    if (root === parent) return false

    const current = currentID()
    if (!current) return true

    return root !== current
  })

  const showCaller = createMemo(() => {
    const parent = parentID()
    if (!parent) return false

    const current = currentID()
    if (!current) return true

    return parent !== current
  })

  return (
    <DialogSelect
      title={title()}
      options={[
        {
          title: "Open session",
          value: "subagent.view",
          description: "View this session",
          onSelect: (dialog: DialogContext) => {
            route.navigate({
              type: "session",
              sessionID: props.sessionID,
            })
            dialog.clear()
          },
        },
        ...(showRoot()
          ? [
              {
                title: "Open root session",
                value: "subagent.root",
                description: "Go to the primary session for this thread",
                onSelect: (dialog: DialogContext) => {
                  const root = rootID()
                  if (root) {
                    route.navigate({ type: "session", sessionID: root })
                  }
                  dialog.clear()
                },
              },
            ]
          : []),
        ...(showCaller()
          ? [
              {
                title: "Open parent session",
                value: "subagent.parent",
                description: "Go to the session that spawned this subagent",
                onSelect: (dialog: DialogContext) => {
                  const parent = parentID()
                  if (parent) {
                    route.navigate({ type: "session", sessionID: parent })
                  }
                  dialog.clear()
                },
              },
            ]
          : []),
      ]}
    />
  )
}
