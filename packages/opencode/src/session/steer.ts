import { Bus } from "../bus"
import { BusEvent } from "../bus/bus-event"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import z from "zod"

export namespace SessionSteer {
  const log = Log.create({ service: "session.steer" })

  export type Mode = "queue" | "steer"

  const QueuedMessageSchema = z.object({
    id: z.string(),
    text: z.string(),
    time: z.number(),
    mode: z.enum(["queue", "steer"]),
  })

  export const Event = {
    QueueChanged: BusEvent.define(
      "session.queue.changed",
      z.object({
        sessionID: z.string(),
        queue: z.array(QueuedMessageSchema),
      }),
    ),
  }

  export interface QueuedMessage {
    id: string
    text: string
    time: number
    mode: Mode
  }

  interface SteerState {
    pending: QueuedMessage[]
  }

  const state = Instance.state(
    () => {
      const data: Record<string, SteerState> = {}
      return data
    },
    async () => {},
  )

  function ensure(sessionID: string): SteerState {
    const s = state()
    if (!s[sessionID]) s[sessionID] = { pending: [] }
    return s[sessionID]
  }

  /** Push a message into the pending buffer for an active session. */
  export function push(sessionID: string, text: string, mode: Mode = "queue"): QueuedMessage {
    const entry: QueuedMessage = {
      id: crypto.randomUUID(),
      text,
      time: Date.now(),
      mode,
    }
    const s = ensure(sessionID)
    s.pending.push(entry)
    log.info("steer.push", { sessionID, id: entry.id, queueLength: s.pending.length })
    Bus.publish(Event.QueueChanged, { sessionID, queue: s.pending })
    return entry
  }

  /** Drain all pending messages and return them. Clears the buffer. */
  export function take(sessionID: string): QueuedMessage[] {
    const s = state()[sessionID]
    if (!s || s.pending.length === 0) return []
    const result = s.pending.splice(0)
    log.info("steer.take", { sessionID, count: result.length })
    Bus.publish(Event.QueueChanged, { sessionID, queue: s.pending })
    return result
  }

  /** Drain only messages matching the given mode. Leaves other messages in the buffer. */
  export function takeByMode(sessionID: string, mode: Mode): QueuedMessage[] {
    const s = state()[sessionID]
    if (!s || s.pending.length === 0) return []
    const matched: QueuedMessage[] = []
    const remaining: QueuedMessage[] = []
    for (const m of s.pending) {
      if (m.mode === mode) matched.push(m)
      else remaining.push(m)
    }
    if (matched.length === 0) return []
    s.pending = remaining
    log.info("steer.takeByMode", { sessionID, mode, count: matched.length })
    Bus.publish(Event.QueueChanged, { sessionID, queue: s.pending })
    return matched
  }

  /** Check if there's pending steered input for a session. */
  export function has(sessionID: string): boolean {
    const s = state()[sessionID]
    return !!s && s.pending.length > 0
  }

  /** Get the current queue without draining. */
  export function list(sessionID: string): QueuedMessage[] {
    return state()[sessionID]?.pending ?? []
  }

  /** Remove a specific queued message by id. */
  export function remove(sessionID: string, id: string): boolean {
    const s = state()[sessionID]
    if (!s) return false
    const idx = s.pending.findIndex((m) => m.id === id)
    if (idx === -1) return false
    s.pending.splice(idx, 1)
    log.info("steer.remove", { sessionID, id })
    Bus.publish(Event.QueueChanged, { sessionID, queue: s.pending })
    return true
  }

  /** Clear all pending messages for a session. */
  export function clear(sessionID: string) {
    const s = state()[sessionID]
    if (!s || s.pending.length === 0) return
    s.pending.length = 0
    log.info("steer.clear", { sessionID })
    Bus.publish(Event.QueueChanged, { sessionID, queue: s.pending })
  }
}
