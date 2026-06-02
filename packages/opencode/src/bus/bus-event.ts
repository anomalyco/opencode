import type { Schema } from "effect"

export function define<A>(name: string, _schema: Schema.Schema<A>) {
  return { name, _schema } as const
}

export type BusEvent<A> = ReturnType<typeof define<A>>

export * as BusEvent from "./bus-event"
