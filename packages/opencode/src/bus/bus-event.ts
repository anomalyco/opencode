import z from "zod"
import { Schema } from "effect"
import { zodObject } from "@/util/effect-zod"

export type Definition<Type extends string = string, Properties extends Schema.Top = Schema.Top> = {
  type: Type
  properties: Properties
}

const registry = new Map<string, Definition>()

export function define<Type extends string, Properties extends Schema.Top>(
  type: Type,
  properties: Properties,
): Definition<Type, Properties> {
  const result = { type, properties }
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
          properties: zodObject(def.properties),
        })
        .meta({
          ref: `Event.${def.type}`,
        })
    })
    .toArray()
}

export function effectPayloads() {
  return registry
    .entries()
    .map(([type, def]) =>
      Schema.Struct({
        type: Schema.Literal(type),
        properties: def.properties,
      }).annotate({ identifier: `Event.${type}` }),
    )
    .toArray()
}

export * as BusEvent from "./bus-event"
