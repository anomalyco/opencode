import { ServerConnection } from "@/context/servers"

export const SESSION_TABS_REMOVED_EVENT = "opencode:session-tabs-removed"

export type SessionTabsRemovedDetail = {
  server: ServerConnection.Key
  directory: string
  sessionIDs: string[]
}

export function notifySessionTabsRemoved(input: SessionTabsRemovedDetail) {
  window.dispatchEvent(new CustomEvent(SESSION_TABS_REMOVED_EVENT, { detail: input }))
}

export function readSessionTabsRemovedDetail(event: Event): SessionTabsRemovedDetail | undefined {
  if (!(event instanceof CustomEvent)) return undefined

  const detail: unknown = event.detail
  if (!detail || typeof detail !== "object") return undefined
  if (!("directory" in detail)) return undefined
  if (!("sessionIDs" in detail)) return undefined
  if (!("server" in detail) || typeof detail.server !== "string") return undefined
  if (typeof detail.directory !== "string") return undefined
  if (!Array.isArray(detail.sessionIDs)) return undefined

  const sessionIDs = detail.sessionIDs.filter((id): id is string => typeof id === "string")
  if (sessionIDs.length === 0) return undefined

  return {
    server: ServerConnection.Key.make(detail.server),
    directory: detail.directory,
    sessionIDs,
  }
}
