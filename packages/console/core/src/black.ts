import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"
import { BlackPlans } from "./schema/billing.sql"

export namespace BlackData {
  const Schema = z.object({
    "200": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
    "100": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
    "20": z.object({
      fixedLimit: z.number().int(),
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
    }),
  })

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const getLimits = fn(
    z.object({
      plan: z.enum(BlackPlans),
    }),
    ({ plan }) => {
      const json = JSON.parse(Resource.ZEN_BLACK_LIMITS.value)
      return Schema.parse(json)[plan]
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
