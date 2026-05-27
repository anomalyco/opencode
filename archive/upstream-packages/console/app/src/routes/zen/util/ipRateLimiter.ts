import { Database, eq, and, sql, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { IpRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { FreeUsageLimitError } from "./error"
import { logger } from "./logger"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export function createRateLimiter(modelId: string, rateLimit: number | undefined, rawIp: string, request: Request) {
  const dict = i18n(localeFromRequest(request))

  const limits = Subscription.getFreeLimits()
  const dailyLimit = rateLimit ?? limits.dailyRequests
  const isDefaultModel = !rateLimit

  const ip = !rawIp.length ? "unknown" : rawIp
  const now = Date.now()
  const lifetimeInterval = ""
  const dailyInterval = rateLimit ? `${buildYYYYMMDD(now)}${modelId.substring(0, 2)}` : buildYYYYMMDD(now)

  let _isNew: boolean

  return {
    check: async () => {
      const rows = await Database.use((tx) =>
        tx
          .select({ interval: IpRateLimitTable.interval, count: IpRateLimitTable.count })
          .from(IpRateLimitTable)
          .where(
            and(
              eq(IpRateLimitTable.ip, ip),
              isDefaultModel
                ? inArray(IpRateLimitTable.interval, [lifetimeInterval, dailyInterval])
                : inArray(IpRateLimitTable.interval, [dailyInterval]),
            ),
          ),
      )
      const lifetimeCount = rows.find((r) => r.interval === lifetimeInterval)?.count ?? 0
      const dailyCount = rows.find((r) => r.interval === dailyInterval)?.count ?? 0
      logger.debug(`rate limit lifetime: ${lifetimeCount}, daily: ${dailyCount}`)

      _isNew = isDefaultModel && lifetimeCount < dailyLimit * 7

      if ((_isNew && dailyCount >= dailyLimit * 2) || (!_isNew && dailyCount >= dailyLimit))
        throw new FreeUsageLimitError(dict["zen.api.error.rateLimitExceeded"], getRetryAfterDay(now))
    },
    track: async () => {
      await Database.use((tx) =>
        tx
          .insert(IpRateLimitTable)
          .values([
            { ip, interval: dailyInterval, count: 1 },
            ...(_isNew ? [{ ip, interval: lifetimeInterval, count: 1 }] : []),
          ])
          .onDuplicateKeyUpdate({ set: { count: sql`${IpRateLimitTable.count} + 1` } }),
      )
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
