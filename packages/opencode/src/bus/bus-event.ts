import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"

export namespace BusEvent {
  const log = Log.create({ service: "event" })

  export type Definition = ReturnType<typeof define>

  const registry = new Map<string, Definition>()

  export function define<Type extends string, Properties extends ZodType>(type: Type, properties: Properties) {
    const result = {
      type,
      properties,
    }
    registry.set(type, result)
    return result
  }

  export function payloads() {
    const options = Array.from(registry.entries()).map(([type, def]) => {
      return z
        .object({
          type: z.literal(type),
          properties: def.properties,
        })
        .meta({
          ref: "Event" + "." + def.type,
        })
    })
    const entries = options as unknown as Parameters<typeof z.discriminatedUnion>[1]
    return z.discriminatedUnion("type", entries).meta({
      ref: "Event",
    })
  }
}
