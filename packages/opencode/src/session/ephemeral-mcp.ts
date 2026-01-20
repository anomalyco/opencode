import { Instance } from "@/project/instance"
import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"

export namespace EphemeralMcp {
  export const Event = BusEvent.define(
    "session.ephemeral_mcp",
    z.object({
      sessionID: z.string(),
      servers: z.array(z.string()),
    }),
  )

  const state = Instance.state(() => {
    const data: Record<string, string[]> = {}
    return data
  })

  export function set(sessionID: string, servers: string[]) {
    state()[sessionID] = servers
    Bus.publish(Event, { sessionID, servers })
  }

  export function get(sessionID: string): string[] {
    return state()[sessionID] ?? []
  }

  export function clear(sessionID: string) {
    delete state()[sessionID]
    Bus.publish(Event, { sessionID, servers: [] })
  }

  export function list() {
    return state()
  }
}
