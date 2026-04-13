import type { Database } from "bun:sqlite"
import { getRegistry, upsertRegistry, deleteRegistry, markOrphaned } from "../db"
import type { PluginConfig } from "../config"

type Deps = {
  db: Database
  config: PluginConfig
}

export function createEventHook(deps: Deps) {
  return async (input: { event: { type: string; properties: Record<string, any> } }) => {
    const { type, properties } = input.event
    const sessionID = properties.sessionID

    if (type === "session.created") {
      const hasParent = Boolean(properties.info?.parentID)
      upsertRegistry(deps.db, sessionID, {
        status: "available",
        last_active: Date.now(),
        is_subsession: hasParent ? 1 : 0,
      })
      return
    }

    if (type === "session.idle") {
      upsertRegistry(deps.db, sessionID, {
        status: "available",
        current_depth: 0,
        last_active: Date.now(),
      })
      return
    }

    if (type === "session.updated") {
      const hasParent = Boolean(properties.info?.parentID)
      upsertRegistry(deps.db, sessionID, {
        last_active: Date.now(),
        is_subsession: hasParent ? 1 : 0,
      })
      return
    }

    if (type === "session.error") {
      upsertRegistry(deps.db, sessionID, {
        status: "error",
        last_active: Date.now(),
      })
      return
    }

    if (type === "session.deleted") {
      markOrphaned(deps.db, sessionID)
      deleteRegistry(deps.db, sessionID)
      return
    }

    if (type === "message.updated") {
      const info = properties.info
      if (info?.role === "user" && info?.agent) {
        upsertRegistry(deps.db, sessionID, {
          last_agent: info.agent,
          last_active: Date.now(),
        })
      }
      return
    }
  }
}
