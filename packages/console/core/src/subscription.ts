import { z } from "zod"
import { fn } from "./util/fn"
import { centsToMicroCents } from "./util/price"
import { getWeekBounds, getMonthlyBounds } from "./util/date"

export namespace Subscription {
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
