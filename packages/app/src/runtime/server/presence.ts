import { createPresence } from "@opencode/client/solid"
import type { OpenCodeClient } from "@opencode/client/promise"
import { uuid } from "@opencode/util/uuid"
import { useTabs } from "../../shell/tabs/tabs"
import type { ServerKey } from "./persistence"

const CLIENT_KEY = "opencode.presence.client"
// Per tab/window: one shared identity would let windows overwrite each other's reported sets.
function presenceClientID() {
  try {
    const existing = sessionStorage.getItem(CLIENT_KEY)
    if (existing) return existing
    const id = uuid()
    sessionStorage.setItem(CLIENT_KEY, id)
    return id
  } catch {
    // Storage disabled (private browsing): a per-load identity still reports correctly.
    return uuid()
  }
}

/** Reports this window's open session tabs for one server, so idle compaction knows they are still watched. */
export function createServerPresence(input: {
  api: () => OpenCodeClient
  connected: () => boolean
  server: typeof ServerKey.Type
}) {
  const tabs = useTabs()
  createPresence({
    client: presenceClientID(),
    api: input.api,
    connected: input.connected,
    sessions: () => {
      // Until the stored tabs load, report nothing rather than guessing the open set.
      if (!tabs.ready()) return []
      const ids = tabs.store.flatMap((tab) =>
        tab.type === "session" && tab.server === input.server
          ? [tab.sessionId, ...(tab.routeSessionId ? [tab.routeSessionId] : [])]
          : [],
      )
      const preview = tabs.preview()
      if (preview && preview.server === input.server) {
        ids.push(preview.sessionId)
        if (preview.routeSessionId) ids.push(preview.routeSessionId)
      }
      return ids
    },
  })
}
