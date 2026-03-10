import { z } from "zod"
import { fn } from "./util/fn"
import { centsToMicroCents } from "./util/price"
import { getWeekBounds, getMonthlyBounds } from "./util/date"
import { Resource } from "@opencode-ai/console-resource"

export namespace Subscription {
  const LimitsSchema = z.object({
    free: z.object({
      promoTokens: z.number().int(),
      dailyRequests: z.number().int(),
      checkHeader: z.string(),
      fallbackValue: z.number().int(),
    }),
    lite: z.object({
      rollingLimit: z.number().int(),
      rollingWindow: z.number().int(),
      weeklyLimit: z.number().int(),
      monthlyLimit: z.number().int(),
    }),
    black: z.object({
      "20": z.object({
        fixedLimit: z.number().int(),
        rollingLimit: z.number().int(),
        rollingWindow: z.number().int(),
      }),
      "100": z.object({
        fixedLimit: z.number().int(),
        rollingLimit: z.number().int(),
        rollingWindow: z.number().int(),
      }),
      "200": z.object({
        fixedLimit: z.number().int(),
        rollingLimit: z.number().int(),
        rollingWindow: z.number().int(),
      }),
    }),
  })

  export const validate = fn(LimitsSchema, (input) => {
    return input
  })

  export const getLimits = fn(z.void(), () => {
    const json = JSON.parse(Resource.ZEN_LIMITS.value)
    return LimitsSchema.parse(json)
  })

  export const getFreeLimits = fn(z.void(), () => {
    return getLimits()["free"]
  })

  export const analyzeRollingUsage = fn(
    z.object({
      limit: z.number().int(),
      window: z.number().int(),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ limit, window, usage, timeUpdated }) => {
      const now = new Date()
      const rollingWindowMs = window * 3600 * 1000
      const rollingLimitInMicroCents = centsToMicroCents(limit * 100)
      const windowStart = new Date(now.getTime() - rollingWindowMs)
      if (timeUpdated < windowStart) {
        return {
          status: "ok" as const,
          resetInSec: window * 3600,
          usagePercent: 0,
        }
      }

      const windowEnd = new Date(timeUpdated.getTime() + rollingWindowMs)
      if (usage < rollingLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((windowEnd.getTime() - now.getTime()) / 1000),
          usagePercent: Math.floor(Math.min(100, (usage / rollingLimitInMicroCents) * 100)),
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
      limit: z.number().int(),
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ limit, usage, timeUpdated }) => {
      const now = new Date()
      const week = getWeekBounds(now)
      const fixedLimitInMicroCents = centsToMicroCents(limit * 100)
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
          usagePercent: Math.floor(Math.min(100, (usage / fixedLimitInMicroCents) * 100)),
        }
      }

      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((week.end.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )

  export const analyzeMonthlyUsage = fn(
    z.object({
      limit: z.number().int(),
      usage: z.number().int(),
      timeUpdated: z.date(),
      timeSubscribed: z.date(),
    }),
    ({ limit, usage, timeUpdated, timeSubscribed }) => {
      const now = new Date()
      const month = getMonthlyBounds(now, timeSubscribed)
      const fixedLimitInMicroCents = centsToMicroCents(limit * 100)
      if (timeUpdated < month.start) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((month.end.getTime() - now.getTime()) / 1000),
          usagePercent: 0,
        }
      }
      if (usage < fixedLimitInMicroCents) {
        return {
          status: "ok" as const,
          resetInSec: Math.ceil((month.end.getTime() - now.getTime()) / 1000),
          usagePercent: Math.floor(Math.min(100, (usage / fixedLimitInMicroCents) * 100)),
        }
      }

      return {
        status: "rate-limited" as const,
        resetInSec: Math.ceil((month.end.getTime() - now.getTime()) / 1000),
        usagePercent: 100,
      }
    },
  )
}
