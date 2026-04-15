import z from "zod"
import type { ZodType } from "zod"

export namespace BusEvent {
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
    return registry
      .entries()
      .map(([type, def]) => {
        return z
          .object({
            type: z.literal(type),
            properties: def.properties,
          })
          .meta({
            ref: "Event" + "." + def.type,
          })
      })
      .toArray()
  }
}
