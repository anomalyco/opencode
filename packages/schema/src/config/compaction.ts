export * as ConfigCompaction from "./compaction.js"

import { Schema } from "effect"
import { NonNegativeInt, optional } from "../schema.js"

export class Keep extends Schema.Class<Keep>("Config.Compaction.Keep")({
  tokens: NonNegativeInt.pipe(optional),
}) {}

/** A share of the model's window such as "20%" or "12.5%", from 1% up to but not including 100%. */
export const Percent = Schema.String.check(Schema.isPattern(/^([1-9]\d?(\.\d+)?)%$/u)).annotate({
  identifier: "Config.Compaction.Percent",
})
export type Percent = typeof Percent.Type

export class Info extends Schema.Class<Info>("Config.Compaction")({
  auto: Schema.Boolean.pipe(optional),
  keep: Keep.pipe(optional),
  buffer: Schema.Union([Percent, NonNegativeInt]).pipe(optional).annotate({
    description:
      'Room kept free below the model\'s context window before automatic compaction, as a share of the window from "1%" to "99%", such as "20%" to compact at 80% full. A token count is also accepted.',
  }),
}) {}
