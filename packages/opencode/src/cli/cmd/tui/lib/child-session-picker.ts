import type { DialogSelectOption } from "@tui/ui/dialog-select"
import { Locale } from "@/util/locale"
import { buildSessionTree } from "./session-tree"

export type ChildSessionPickerSession = {
  id: string
  title: string
  parentID?: string
  time: {
    created: number
    updated: number
  }
}

type PermissionBySession = Record<string, Array<unknown> | undefined>

function isDefaultSessionTitle(title: string): boolean {
  const prefix =
    title.startsWith("New session - ") || title.startsWith("Child session - ") || title.startsWith("Subagent - ")
  if (!prefix) return false
  return /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(title)
}

function shortID(id: string): string {
  if (!id) return ""
  if (id.length <= 8) return id
  return id.slice(-8)
}

function permissionCount(permissions: PermissionBySession, sessionID: string): number {
  const list = permissions[sessionID]
  if (!list) return 0
  return Array.isArray(list) ? list.length : 0
}

export function buildChildSessionPickerOptions(input: {
  currentSessionID: string
  sessions: ChildSessionPickerSession[]
  permissionsBySession: PermissionBySession
}): {
  rootID: string
  options: DialogSelectOption<string>[]
} {
  const tree = buildSessionTree({
    currentSessionID: input.currentSessionID,
    sessions: input.sessions,
    sort: "created",
  })

  const options = tree.list.map((item) => {
    const sessionID = item.id
    const session = tree.sessionByID.get(sessionID)
    const sid = shortID(sessionID)

    const indent = item.depth > 0 ? `${"  ".repeat(item.depth - 1)}↳ ` : ""

    const title = (() => {
      if (sessionID === tree.rootID) {
        const name = session?.title ?? "Root session"
        return `Root · ${name} · ${sid}`
      }

      const name = (() => {
        if (!session) return "Subagent session"
        if (!isDefaultSessionTitle(session.title)) return session.title
        return "Subagent session"
      })()

      return `${indent}${name} · ${sid}`
    })()

    const description = (() => {
      const pending = permissionCount(input.permissionsBySession, sessionID)
      if (pending > 0) return "Needs input"

      if (!session) return
      if (sessionID === tree.rootID) return
      if (!isDefaultSessionTitle(session.title)) return
      return session.title
    })()

    const footer = (() => {
      const pending = permissionCount(input.permissionsBySession, sessionID)
      if (pending > 0) return `${pending} pending`
      if (session) return Locale.todayTimeOrDateTime(session.time.updated)
    })()

    return {
      title,
      value: sessionID,
      description,
      footer,
    } satisfies DialogSelectOption<string>
  })

  return {
    rootID: tree.rootID,
    options,
  }
}
