import { Database, eq, and, sql, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { IpRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { RateLimitError } from "./error"
import { logger } from "./logger"
import { ZenData } from "@opencode-ai/console-core/model.js"

export function createRateLimiter(limit: ZenData.RateLimit | undefined, rawIp: string) {
  if (!limit) return

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
          .select({ count: IpRateLimitTable.count })
          .from(IpRateLimitTable)
          .where(and(eq(IpRateLimitTable.ip, ip), inArray(IpRateLimitTable.interval, intervals))),
      )
      const total = rows.reduce((sum, r) => sum + r.count, 0)
      logger.debug(`rate limit total: ${total}`)
      if (total >= limit.value) throw new RateLimitError(`Rate limit exceeded. Please try again later.`)
    },
  }
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
