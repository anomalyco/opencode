import { Database, eq, and, sql, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { IpRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { FreeUsageLimitError } from "./error"
import { logger } from "./logger"
import { ZenData } from "@opencode-ai/console-core/model.js"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"

export function createRateLimiter(limit: ZenData.RateLimit | undefined, rawIp: string, request: Request) {
  if (!limit) return
  const dict = i18n(localeFromRequest(request))

  const limitValue = limit.checkHeader && !request.headers.get(limit.checkHeader) ? limit.fallbackValue! : limit.value

  const ip = !rawIp.length ? "unknown" : rawIp
  const now = Date.now()
  const intervals =
    limit.period === "day"
      ? [buildYYYYMMDD(now)]
      : [buildYYYYMMDDHH(now), buildYYYYMMDDHH(now - 3_600_000), buildYYYYMMDDHH(now - 7_200_000)]

  return {
    track: async () => {
      await Database.use((tx) =>
        tx
          .insert(IpRateLimitTable)
          .values({ ip, interval: intervals[0], count: 1 })
          .onDuplicateKeyUpdate({ set: { count: sql`${IpRateLimitTable.count} + 1` } }),
      )
    },
    check: async () => {
      const rows = await Database.use((tx) =>
        tx
          .select({ interval: IpRateLimitTable.interval, count: IpRateLimitTable.count })
          .from(IpRateLimitTable)
          .where(and(eq(IpRateLimitTable.ip, ip), inArray(IpRateLimitTable.interval, intervals))),
      )
      const total = rows.reduce((sum, r) => sum + r.count, 0)
      logger.debug(`rate limit total: ${total}`)
      if (total >= limitValue)
        throw new FreeUsageLimitError(
          dict["zen.api.error.rateLimitExceeded"],
          limit.period === "day" ? getRetryAfterDay(now) : getRetryAfterHour(rows, intervals, limitValue, now),
        )
    },
  }
}

export function getRetryAfterDay(now: number) {
  return Math.ceil((86_400_000 - (now % 86_400_000)) / 1000)
}

export function getRetryAfterHour(
  rows: { interval: string; count: number }[],
  intervals: string[],
  limit: number,
  now: number,
) {
  const counts = new Map(rows.map((r) => [r.interval, r.count]))
  // intervals are ordered newest to oldest: [current, -1h, -2h]
  // simulate dropping oldest intervals one at a time
  let running = intervals.reduce((sum, i) => sum + (counts.get(i) ?? 0), 0)
  for (let i = intervals.length - 1; i >= 0; i--) {
    running -= counts.get(intervals[i]) ?? 0
    if (running < limit) {
      // interval at index i rolls out of the window (intervals.length - i) hours from the current hour start
      const hours = intervals.length - i
      return Math.ceil((hours * 3_600_000 - (now % 3_600_000)) / 1000)
    }
  }
  return Math.ceil((3_600_000 - (now % 3_600_000)) / 1000)
}

function buildYYYYMMDD(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 8)
}

function buildYYYYMMDDHH(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 10)
}
