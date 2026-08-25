import type { ServerConnection } from "@/runtime/server/registry"
import type { Tab } from "./tabs"

export function migrateTabs(value: unknown): Tab[] {
  if (!Array.isArray(value)) return []
  return value.flatMap<Tab>((tab) => {
    if (!tab || typeof tab !== "object") return []
    if (!("server" in tab) || typeof tab.server !== "string") return []
    const server = tab.server as ServerConnection.Key
    if (
      tab.type === "session" &&
      typeof tab.sessionId === "string" &&
      (tab.routeSessionId === undefined || typeof tab.routeSessionId === "string") &&
      (tab.routeParentId === undefined || typeof tab.routeParentId === "string")
    ) {
      return [
        {
          type: tab.type,
          server,
          sessionId: tab.sessionId,
          ...(tab.routeSessionId && tab.routeSessionId !== tab.sessionId
            ? {
                routeSessionId: tab.routeSessionId,
                ...(tab.routeParentId ? { routeParentId: tab.routeParentId } : {}),
              }
            : {}),
        },
      ]
    }
    if (
      tab.type === "draft" &&
      typeof tab.draftID === "string" &&
      typeof tab.directory === "string" &&
      (tab.worktree === undefined || typeof tab.worktree === "string") &&
      (tab.branch === undefined || typeof tab.branch === "string")
    ) {
      return [
        {
          type: tab.type,
          server,
          draftID: tab.draftID,
          directory: tab.directory,
          worktree: tab.worktree,
          branch: tab.branch,
        },
      ]
    }
    return []
  })
}
