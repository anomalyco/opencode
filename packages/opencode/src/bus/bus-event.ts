import z from "zod"
import type { ZodType } from "zod"
import { Log } from "../util/log"

/**
 * Typed event definitions for the event bus.
 *
 * Provides a way to define events with Zod schemas for type-safe
 * publishing and subscribing. All defined events are tracked in a
 * registry for payload validation.
 *
 * @example
 * ```typescript
 * const UserCreatedEvent = BusEvent.define(
 *   "user.created",
 *   z.object({ id: z.string(), name: z.string() })
 * )
 * ```
 */
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
    return z
      .discriminatedUnion(
        "type",
        registry
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
          .toArray() as any,
      )
      .meta({
        ref: "Event",
      })
  }
}
