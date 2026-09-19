import type { ServerConnection } from "./server"
import type { Tab } from "./tabs"

export function migrateTabs(value: unknown, fallback: ServerConnection.Key): Tab[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<Tab>((tab) => {
    if (!tab || typeof tab !== "object") return []
    if ("server" in tab && typeof tab.server !== "string") return []
    const server = ("server" in tab ? tab.server : fallback) as ServerConnection.Key
    if (tab.type === "session" && typeof tab.sessionId === "string") {
      return [{ type: tab.type, server, sessionId: tab.sessionId }]
    }
    // A directory decoded to U+FFFD can never resolve, so do not restore a draft that points at it.
    if (
      tab.type === "draft" &&
      typeof tab.draftID === "string" &&
      typeof tab.directory === "string" &&
      !tab.directory.includes("\uFFFD") &&
      (tab.worktree === undefined || typeof tab.worktree === "string")
    ) {
      return [{ type: tab.type, server, draftID: tab.draftID, directory: tab.directory, worktree: tab.worktree }]
    }
    return []
  })
}
