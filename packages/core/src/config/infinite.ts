export * as ConfigInfinite from "./infinite"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class Info extends Schema.Class<Info>("ConfigV2.Infinite")({
  maxIterations: PositiveInt.pipe(Schema.optional),
  maxHours: PositiveInt.pipe(Schema.optional),
  sentinel: Schema.String.pipe(Schema.optional),
  todoDetection: Schema.Boolean.pipe(Schema.optional),
}) {}

export const Defaults = {
  maxIterations: 100,
  maxHours: 8,
  sentinel: "[TASK_COMPLETE]",
  todoDetection: true,
} as const

export type Resolved = {
  readonly maxIterations: number
  readonly maxHours: number
  readonly sentinel: string
  readonly todoDetection: boolean
}

export const resolve = (infos: ReadonlyArray<Info>): Resolved => {
  const merged = infos.reduce<Resolved>(
    (result, current) => ({
      maxIterations: current.maxIterations ?? result.maxIterations,
      maxHours: current.maxHours ?? result.maxHours,
      sentinel: current.sentinel ?? result.sentinel,
      todoDetection: current.todoDetection ?? result.todoDetection,
    }),
    { ...Defaults },
  )
  return merged
}
