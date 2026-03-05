import { Database, eq, and, sql, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { IpRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { FreeUsageLimitError } from "./error"
import { logger } from "./logger"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export function createRateLimiter(allowAnonymous: boolean | undefined, rawIp: string, request: Request) {
  if (!allowAnonymous) return
  const dict = i18n(localeFromRequest(request))

  const limits = Subscription.getFreeLimits()
  const limitValue =
    limits.checkHeader && !request.headers.get(limits.checkHeader) ? limits.fallbackValue : limits.dailyRequests

  const ip = !rawIp.length ? "unknown" : rawIp
  const now = Date.now()
  const interval = buildYYYYMMDD(now)

  return {
    track: async () => {
      await Database.use((tx) =>
        tx
          .insert(IpRateLimitTable)
          .values({ ip, interval, count: 1 })
          .onDuplicateKeyUpdate({ set: { count: sql`${IpRateLimitTable.count} + 1` } }),
      )
    },
    check: async () => {
      const rows = await Database.use((tx) =>
        tx
          .select({ interval: IpRateLimitTable.interval, count: IpRateLimitTable.count })
          .from(IpRateLimitTable)
          .where(and(eq(IpRateLimitTable.ip, ip), inArray(IpRateLimitTable.interval, [interval]))),
      )
      const total = rows.reduce((sum, r) => sum + r.count, 0)
      logger.debug(`rate limit total: ${total}`)
      if (total >= limitValue)
        throw new FreeUsageLimitError(dict["zen.api.error.rateLimitExceeded"], getRetryAfterDay(now))
    },
  }
}

export function getRetryAfterDay(now: number) {
  return Math.ceil((86_400_000 - (now % 86_400_000)) / 1000)
}

function buildYYYYMMDD(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 8)
}
