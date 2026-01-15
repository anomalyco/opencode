import { z } from "zod"
import { fn } from "./util/fn"
import { Resource } from "@opencode-ai/console-resource"
import { centsToMicroCents } from "./util/price"
import { getWeekBounds } from "./util/date"

export namespace BlackData {
  const Schema = z.object({
    fixedLimit: z.number().int(),
    rollingLimit: z.number().int(),
    rollingWindow: z.number().int(),
  })

  export const validate = fn(Schema, (input) => {
    return input
  })

  export const get = fn(z.void(), () => {
    const json = JSON.parse(Resource.ZEN_BLACK.value)
    return Schema.parse(json)
  })
}

export namespace Black {
  export const analyzeRollingUsage = fn(
    z.object({
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ usage, timeUpdated }) => {
      const now = new Date()
      const black = BlackData.get()
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
      usage: z.number().int(),
      timeUpdated: z.date(),
    }),
    ({ usage, timeUpdated }) => {
      const black = BlackData.get()
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
