import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"

export namespace LiteData {
  const Schema = z.object({
    fixedLimit: z.number().int(),
    rollingLimit: z.number().int(),
    rollingWindow: z.number().int(),
  })

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const getLimits = fn(z.void(), () => {
    const json = JSON.parse(Resource.ZEN_LITE_LIMITS.value)
    return Schema.parse(json)
  })

  export const planToPriceID = fn(z.void(), () => {
    return Resource.ZEN_LITE_PRICE.price
  })

  export const priceIDToPlan = fn(z.void(), () => {
    return "lite"
  })
}
