export * as Money from "./money.js"

import { Schema } from "effect"

export const USD = Schema.Finite.annotate({ identifier: "Money.USD" })
export type USD = typeof USD.Type

export const USDPerMillionTokens = Schema.Finite.annotate({ identifier: "Money.USDPerMillionTokens" })
export type USDPerMillionTokens = typeof USDPerMillionTokens.Type
