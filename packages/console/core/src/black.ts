import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"
import { BlackPlans } from "./schema/billing.sql"
import { Subscription } from "./subscription"

export namespace BlackData {
  export const getLimits = fn(
    z.object({
      plan: z.enum(BlackPlans),
    }),
    ({ plan }) => {
      return Subscription.getLimits()["black"][plan]
    },
  )

  export const productID = fn(z.void(), () => Resource.ZEN_BLACK_PRICE.product)

  export const planToPriceID = fn(
    z.object({
      plan: z.enum(BlackPlans),
    }),
    ({ plan }) => {
      if (plan === "200") return Resource.ZEN_BLACK_PRICE.plan200
      if (plan === "100") return Resource.ZEN_BLACK_PRICE.plan100
      return Resource.ZEN_BLACK_PRICE.plan20
    },
  )

  export const priceIDToPlan = fn(
    z.object({
      priceID: z.string(),
    }),
    ({ priceID }) => {
      if (priceID === Resource.ZEN_BLACK_PRICE.plan200) return "200"
      if (priceID === Resource.ZEN_BLACK_PRICE.plan100) return "100"
      return "20"
    },
  )
}
