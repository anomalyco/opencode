import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"
import { Subscription } from "./subscription"

export namespace LiteData {
  export const getLimits = fn(z.void(), () => {
    return Subscription.getLimits()["lite"]
  })

  export const productID = fn(z.void(), () => Resource.ZEN_LITE_PRICE.product)
  export const priceID = fn(z.void(), () => Resource.ZEN_LITE_PRICE.price)
  export const priceInr = fn(z.void(), () => Resource.ZEN_LITE_PRICE.priceInr)
  export const firstMonth100Coupon = Resource.ZEN_LITE_PRICE.firstMonth100Coupon
  export const firstMonth50Coupon = Resource.ZEN_LITE_PRICE.firstMonth50Coupon
  export const threeMonths100Coupon = Resource.ZEN_LITE_PRICE.threeMonths100Coupon
  export const sixMonths100Coupon = Resource.ZEN_LITE_PRICE.sixMonths100Coupon
  export const twelveMonths100Coupon = Resource.ZEN_LITE_PRICE.twelveMonths100Coupon
  export const planName = fn(z.void(), () => "lite")
}
