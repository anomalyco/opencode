export * as Money from "./money.js"

import { Schema } from "effect"

export const USD = Schema.Finite.pipe(Schema.brand("Money.USD"), Schema.annotate({ identifier: "Money.USD" }))
export type USD = typeof USD.Type

export const USDPerMillionTokens = Schema.Finite.pipe(
  Schema.brand("Money.USDPerMillionTokens"),
  Schema.annotate({ identifier: "Money.USDPerMillionTokens" }),
)
export type USDPerMillionTokens = typeof USDPerMillionTokens.Type
