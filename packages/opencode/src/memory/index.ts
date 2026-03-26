import { Bus } from "../bus"
import { Session } from "../session"
import { Log } from "../util/log"
import { summarizeSession } from "./summarize"
import { MemoryStore } from "./store"
import { buildMemoryContext } from "./inject"

export { buildMemoryContext }
export { MemoryStore }

const log = Log.create({ service: "memory" })

export function initMemory(): void {
  // Subscribe to session updates — detect when a session is archived (ended).
  // Uses the same Bus.subscribe pattern as bootstrap.ts.
  Bus.subscribe(Session.Event.Updated, async (payload) => {
    const info = payload.properties.info
    // Only act when the session is being archived
    if (!info.time?.archived) return

    const sessionID = payload.properties.sessionID
    try {
      const sessionInfo = await Session.get(sessionID).catch(() => null)
      if (!sessionInfo) return

      const summary = await summarizeSession(sessionID, sessionInfo.title ?? null, sessionInfo.directory)
      MemoryStore.save({
        sessionId: sessionID,
        projectDir: sessionInfo.directory,
        title: sessionInfo.title ?? null,
        summary,
        createdAt: Date.now(),
      })
      log.info("memory saved", { sessionID, directory: sessionInfo.directory })
    } catch (err) {
      log.error("failed to save memory", { sessionID, err })
    }
  })
}
