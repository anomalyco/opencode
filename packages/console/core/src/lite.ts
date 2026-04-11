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
  export const firstMonthCoupon = fn(z.string(), (email) => {
    const invitees = Resource.ZEN_LITE_COUPON_FIRST_MONTH_100_INVITEES.value.split(",")
    return invitees.includes(email)
      ? Resource.ZEN_LITE_PRICE.firstMonth100Coupon
      : Resource.ZEN_LITE_PRICE.firstMonth50Coupon
  })
  export const planName = fn(z.void(), () => "lite")
}
