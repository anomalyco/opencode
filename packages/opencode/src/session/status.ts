import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import z from "zod"

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
    Status: Bus.event(
      "session.status",
      z.object({
        sessionID: z.string(),
        parentID: z.string().optional(),
        status: Info,
      }),
    ),
    // deprecated
    Idle: Bus.event(
      "session.idle",
      z.object({
        sessionID: z.string(),
        parentID: z.string().optional(),
      }),
    ),
  }

  const state = Instance.state(() => {
    const data: Record<string, Info> = {}
    return data
  })

  export function get(sessionID: string) {
    return (
      state()[sessionID] ?? {
        type: "idle",
      }
    )
  }

  export function list() {
    return Object.values(state())
  }

  export async function set(sessionID: string, status: Info) {
    const session = await Session.get(sessionID)
    Bus.publish(Event.Status, {
      sessionID,
      parentID: session.parentID,
      status,
    })
    if (status.type === "idle") {
      // deprecated
      const session = await Session.get(sessionID)
      Bus.publish(Event.Idle, {
        sessionID,
        parentID: session.parentID,
      })
      delete state()[sessionID]
      return
    }
    state()[sessionID] = status
  }
}
