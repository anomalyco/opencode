export const SESSION_TABS_REMOVED_EVENT = "opencode:session-tabs-removed"

export type SessionTabsRemovedDetail = {
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
  if (typeof detail.directory !== "string") return undefined
  if (!Array.isArray(detail.sessionIDs)) return undefined

  const sessionIDs = detail.sessionIDs.filter((id): id is string => typeof id === "string")
  if (sessionIDs.length === 0) return undefined

  return {
    directory: detail.directory,
    sessionIDs,
  }
}
