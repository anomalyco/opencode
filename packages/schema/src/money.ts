export * as Money from "./money.js"

import { brand } from "./brand.js"
import { Schema } from "effect"
import { statics } from "./schema.js"

export const USD = Schema.Finite.pipe(
  brand("Money.USD"),
  Schema.annotate({ identifier: "Money.USD" }),
  statics((schema) => ({ zero: schema.make(0) })),
)
export type USD = typeof USD.Type

export const USDPerMillionTokens = Schema.Finite.pipe(
  brand("Money.USDPerMillionTokens"),
  Schema.annotate({ identifier: "Money.USDPerMillionTokens" }),
  statics((schema) => ({ zero: schema.make(0) })),
)
export type USDPerMillionTokens = typeof USDPerMillionTokens.Type
