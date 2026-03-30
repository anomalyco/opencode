import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { MessageV2 } from "./message-v2"
import { Log } from "@/util/log"

const log = Log.create({ service: "session.activity" })

/**
 * Tracks per-session last-activity timestamps via Bus events.
 *
 * Activity signals:
 *   - message.part.delta  (token streaming — highest frequency)
 *   - message.part.updated (tool state changes, text completions)
 *
 * The watchdog queries `stale(sessionID, threshold)` to detect sessions
 * that have had no activity for longer than the threshold, distinguishing
 * "genuinely stuck / idle" from "actively streaming or executing tools".
 *
 * Root sessions (no parentID) are never subject to idle detection — only
 * subagent sessions spawned by the task tool are monitored.
 */
export namespace SessionActivity {
  const state = Instance.state(() => {
    const data: Record<string, number> = {}
    return data
  })

  /** Update the last-activity timestamp for a session. */
  export function touch(id: string, now = Date.now()) {
    state()[id] = now
  }

  /** Return the last-activity timestamp, or undefined if never recorded. */
  export function last(id: string): number | undefined {
    return state()[id]
  }

  /**
   * True when the session has had no activity for longer than `threshold` ms.
   * Returns false for sessions with no recorded activity (they haven't
   * started yet, so they aren't stale).
   */
  export function stale(id: string, threshold: number): boolean {
    const ts = state()[id]
    if (ts === undefined) return false
    return Date.now() - ts > threshold
  }

  /** Remove tracking for a session (cleanup on cancel / completion). */
  export function remove(id: string) {
    delete state()[id]
  }

  /** Snapshot of all tracked sessions — for diagnostics / logging. */
  export function list() {
    return { ...state() }
  }

  /**
   * Subscribe to Bus events that indicate session activity.
   * Call once during bootstrap (idempotent per Instance lifecycle
   * since Instance.state is scoped to the current instance).
   */
  export function init() {
    log.info("init")

    // Token deltas — fires on every chunk from the LLM stream.
    // This is the highest-frequency signal and acts as a natural heartbeat.
    Bus.subscribe(MessageV2.Event.PartDelta, (evt) => {
      touch(evt.properties.sessionID)
    })

    // Part state changes — tool start/complete/error, text start/end, etc.
    Bus.subscribe(MessageV2.Event.PartUpdated, (evt) => {
      touch(evt.properties.part.sessionID)
    })
  }
}
