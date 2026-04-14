import type { Orchestrator } from "../orchestrator/index.js"

export function createEventHandlerHook(orch: Orchestrator) {
  return async (input: { event: any }): Promise<void> => {
    const event = input.event

    if (event.type === "session.idle") {
      const sessionID = event.properties?.sessionID
      if (sessionID) {
        const agent = orch.getInfo(sessionID)
        if (agent) {
          if (agent.status === "busy") {
            orch.registry.updateStatus(sessionID, "idle")
          }
          const msg = orch.router.drain(sessionID)
          if (msg) {
            orch.registry.updateStatus(sessionID, "busy")
          }
        }
      }
    }

    if (event.type === "file.watcher.updated") {
      const file = event.properties?.file
      if (file) {
        await orch.audit.append({
          agent: "system",
          action: "file.watcher.updated",
          target: file,
          details: { event: event.properties?.event },
        })
      }
    }

    if (event.type === "session.error") {
      const sessionID = event.properties?.sessionID
      if (sessionID) {
        await orch.audit.append({
          agent: sessionID,
          action: "session.error",
          details: { error: event.properties?.error?.message ?? "unknown error" },
        })
      }
    }
  }
}
