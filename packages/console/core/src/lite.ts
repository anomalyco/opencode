import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"

export namespace LiteData {
  const Schema = z.object({
    rollingLimit: z.number().int(),
    rollingWindow: z.number().int(),
    weeklyLimit: z.number().int(),
    monthlyLimit: z.number().int(),
  })

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const getLimits = fn(z.void(), () => {
    const json = JSON.parse(Resource.ZEN_LITE_LIMITS.value)
    return Schema.parse(json)
  })

  export const productID = fn(z.void(), () => Resource.ZEN_LITE_PRICE.product)
  export const priceID = fn(z.void(), () => Resource.ZEN_LITE_PRICE.price)
  export const planName = fn(z.void(), () => "lite")
}
