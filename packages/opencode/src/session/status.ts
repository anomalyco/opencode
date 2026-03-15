import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { SessionID } from "./schema"
import z from "zod"
import { Log } from "../util/log"
import { LogExtractor } from "../knowledge/extractors/logs"
import { PatternExtractor } from "../knowledge/extractors/patterns"
import { Session } from "./index"

const log = Log.create({ service: "session.status" })

export namespace SessionStatus {
  export const Info = z
    .union([
      z.object({
        type: z.literal("idle"),
      }),
      z.object({
        type: z.literal("retry"),
        attempt: z.number(),
        message: z.string(),
        next: z.number(),
      }),
      z.object({
        type: z.literal("busy"),
      }),
    ])
    .meta({
      ref: "SessionStatus",
    })
  export type Info = z.infer<typeof Info>

  export const Event = {
    Status: BusEvent.define(
      "session.status",
      z.object({
        sessionID: SessionID.zod,
        status: Info,
      }),
    ),
    // deprecated
    Idle: BusEvent.define(
      "session.idle",
      z.object({
        sessionID: SessionID.zod,
      }),
    ),
    Writeback: BusEvent.define(
      "session.writeback",
      z.object({
        sessionID: SessionID.zod,
        stepCount: z.number(),
        hasSignificantWork: z.boolean(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: SessionID) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return state()
  }

  export function set(sessionID: SessionID, status: Info) {
    Bus.publish(Event.Status, {
      sessionID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      Bus.publish(Event.Idle, {
        sessionID,
      })
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }

  export async function onIdle(sessionID: SessionID, stepCount: number): Promise<void> {
    try {
      log.info("session idle, triggering writebacks", { sessionID, stepCount })

      // Check if session has significant work (file changes, tool executions)
      const hasSignificantWork = await hasWork(sessionID)

      // REQUIRED: Always write log if significant work was done
      if (hasSignificantWork) {
        await LogExtractor.extract(sessionID)
      }

      // Thresholds for additional writebacks
      // <20 steps: 1 entry (log only, if work done)
      // 20-40 steps: 2 entries (log + pattern)
      // >=40 steps: 3+ entries (log + pattern + knowledge)

      if (stepCount >= 20 && hasSignificantWork) {
        // Extract pattern
        await PatternExtractor.extract(sessionID)
      }

      if (stepCount >= 40 && hasSignificantWork) {
        // Could extract knowledge here in future
        // For now, patterns + logs is sufficient
      }

      // Publish event
      Bus.publish(Event.Writeback, { sessionID, stepCount, hasSignificantWork })
    } catch (err) {
      log.error("onIdle failed", { error: err, sessionID })
    }
  }

  async function hasWork(sessionID: SessionID): Promise<boolean> {
    try {
      const session = await Session.get(sessionID)
      if (!session) return false

      // Has work if:
      // - Files were modified/added/deleted (summary has changes)
      // - Code changes made (additions or deletions)

      const hasFileChanges =
        (session.summary?.files ?? 0) > 0 ||
        (session.summary?.additions ?? 0) > 0 ||
        (session.summary?.deletions ?? 0) > 0

      return hasFileChanges
    } catch (err) {
      log.error("hasWork check failed", { error: err, sessionID })
      return false
    }
  }
}
