type Tab = { type: "session"; server: string; sessionId: string } | { type: "draft"; server: string }

export function traySessionIDs(tabs: readonly Tab[]) {
  // Drafts have no durable Session yet. The tray currently monitors the base
  // service, so remote/WSL tab IDs must never be looked up on that service.
  return [
    ...new Set(tabs.flatMap((tab) => (tab.type === "session" && tab.server === "sidecar" ? [tab.sessionId] : []))),
  ]
}
