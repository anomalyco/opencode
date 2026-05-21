import { Schema } from "effect"
import { EventV2 } from "@opencode-ai/core/event"

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

export function effectPayloads() {
  return [
    ...registry
      .entries()
      .map(([type, def]) =>
        Schema.Struct({
          id: Schema.String,
          type: Schema.Literal(type),
          properties: def.properties,
        }).annotate({ identifier: `Event.${type}` }),
      )
      .toArray(),
    ...EventV2.registry
      .values()
      .map((definition) =>
        Schema.Struct({
          id: Schema.String,
          type: Schema.Literal(definition.type),
          properties: definition.data,
        }).annotate({ identifier: `Event.${definition.type}` }),
      )
      .toArray(),
  ]
}

export * as BusEvent from "./bus-event"
