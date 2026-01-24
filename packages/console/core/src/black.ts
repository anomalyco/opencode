import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"
import { centsToMicroCents } from "./util/price"
import { getWeekBounds } from "./util/date"
import { SubscriptionPlan } from "./schema/billing.sql"

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
      plan: z.enum(SubscriptionPlan),
    }),
    ({ plan }) => {
      const json = JSON.parse(Resource.ZEN_BLACK_LIMITS.value)
      return Schema.parse(json)[plan]
    },
  )

  export const planToPriceID = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
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

export namespace Black {
  export const analyzeRollingUsage = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ plan, usage, timeUpdated }) => {
      const now = new Date()
      const black = BlackData.getLimits({ plan })
      const rollingWindowMs = black.rollingWindow * 3600 * 1000
      const rollingLimitInMicroCents = centsToMicroCents(black.rollingLimit * 100)
      const windowStart = new Date(now.getTime() - rollingWindowMs)
      if (timeUpdated < windowStart) {
        return {
          status: "ok" as const,
          resetInSec: black.rollingWindow * 3600,
          usagePercent: 0,
        }
      }

      const windowEnd = new Date(timeUpdated.getTime() + rollingWindowMs)
      if (usage < rollingLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
          usagePercent: Math.ceil(Math.min(100, (usage / rollingLimitInMicroCents) * 100)),
        }
      }
      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )

  export const analyzeWeeklyUsage = fn(
    z.object({
      plan: z.enum(SubscriptionPlan),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ plan, usage, timeUpdated }) => {
      const black = BlackData.getLimits({ plan })
      const now = new Date()
      const week = getWeekBounds(now)
      const fixedLimitInMicroCents = centsToMicroCents(black.fixedLimit * 100)
      if (timeUpdated < week.start) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
          usagePercent: 0,
        }
      }
      if (usage < fixedLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
          usagePercent: Math.ceil(Math.min(100, (usage / fixedLimitInMicroCents) * 100)),
        }
      }

      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )
}
