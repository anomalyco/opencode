import { Log } from "@/util/log"

const log = Log.create({ service: "browser.state" })

export interface BrowserSessionState {
  sessionId: string
  currentUrl?: string
  lastSnapshot?: string
  lastSnapshotAt?: number
  isRunning: boolean
  startedAt?: number
  headed: boolean
}

/**
 * Tracks per-session browser state for the agent.
 */
export namespace BrowserState {
  const sessions = new Map<string, BrowserSessionState>()

  export function create(sessionId: string, headed: boolean = true): BrowserSessionState {
    const state: BrowserSessionState = {
      sessionId,
      isRunning: true,
      startedAt: Date.now(),
      headed,
    }
    sessions.set(sessionId, state)
    return state
  }

  export function get(sessionId: string): BrowserSessionState | undefined {
    return sessions.get(sessionId)
  }

  export function update(sessionId: string, updates: Partial<BrowserSessionState>): void {
    const state = sessions.get(sessionId)
    if (!state) return
    Object.assign(state, updates)
  }

  export function setUrl(sessionId: string, url: string): void {
    update(sessionId, { currentUrl: url })
  }

  export function setSnapshot(sessionId: string, snapshot: string): void {
    update(sessionId, { lastSnapshot: snapshot, lastSnapshotAt: Date.now() })
  }

  export function remove(sessionId: string): void {
    sessions.delete(sessionId)
  }

  export function isActive(sessionId: string): boolean {
    return sessions.get(sessionId)?.isRunning ?? false
  }

  export function getSummary(sessionId: string): string {
    const state = sessions.get(sessionId)
    if (!state) return "Browser: not started"
    if (!state.isRunning) return "Browser: stopped"

    const parts = ["Browser: running"]
    if (state.headed) parts.push("(headed)")
    if (state.currentUrl) parts.push(`at ${state.currentUrl}`)
    return parts.join(" ")
  }
}
