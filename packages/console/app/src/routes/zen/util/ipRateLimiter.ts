import { Database, eq, and, sql, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { IpRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { FreeUsageLimitError } from "./error"
import { logger } from "./logger"
import { getRetryAfterDay, type RateLimiter, type RateLimiterState } from "./rateLimit"
import { buildRateLimitKey, redis } from "./redis"
import { i18n, type Dict } from "~/i18n"
import { localeFromRequest } from "~/lib/language"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export function createRateLimiter(modelId: string, rateLimit: number | undefined, rawIp: string, request: Request) {
  const dict = i18n(localeFromRequest(request))

  const limits = Subscription.getFreeLimits()
  // temporarily disable check headers
  //const headersExist = Object.entries(limits.checkHeaders).every(
  //  ([name, value]) => request.headers.get(name)?.toLowerCase().includes(value) ?? false,
  //)
  //const dailyLimit = !headersExist ? limits.dailyRequestsFallback : (rateLimit ?? limits.dailyRequests)
  const headersExist = true
  const dailyLimit = !headersExist ? limits.dailyRequestsFallback : (rateLimit ?? limits.dailyRequests)
  const isDefaultModel = headersExist && !rateLimit

  const ip = !rawIp.length ? "unknown" : rawIp
  const now = Date.now()
  const dailyInterval = rateLimit ? `${buildYYYYMMDD(now)}${modelId.substring(0, 2)}` : buildYYYYMMDD(now)
  const retryAfter = getRetryAfterDay(now)
  const state = { isNew: false, fallbackDatabase: false }
  const databaseLimiter = createDatabaseRateLimiter(ip, dailyInterval, dailyLimit, isDefaultModel, dict, retryAfter, state)
  return createUpstashRateLimiter(ip, dailyInterval, dailyLimit, isDefaultModel, dict, retryAfter, state, databaseLimiter)
}

function createDatabaseRateLimiter(
  ip: string,
  dailyInterval: string,
  dailyLimit: number,
  isDefaultModel: boolean,
  dict: Dict,
  retryAfter: number,
  state: RateLimiterState,
): RateLimiter {
  const lifetimeInterval = ""

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

      state.isNew = isDefaultModel && lifetimeCount < dailyLimit * 7

      if ((state.isNew && dailyCount >= dailyLimit * 2) || (!state.isNew && dailyCount >= dailyLimit))
        throw new FreeUsageLimitError(dict["zen.api.error.rateLimitExceeded"], retryAfter)
    },
    track: async () => {
      await Database.use((tx) =>
        tx
          .insert(IpRateLimitTable)
          .values([
            { ip, interval: dailyInterval, count: 1 },
            ...(state.isNew ? [{ ip, interval: lifetimeInterval, count: 1 }] : []),
          ])
          .onDuplicateKeyUpdate({ set: { count: sql`${IpRateLimitTable.count} + 1` } }),
      )
    },
  }
}

function createUpstashRateLimiter(
  ip: string,
  dailyInterval: string,
  dailyLimit: number,
  isDefaultModel: boolean,
  dict: Dict,
  retryAfter: number,
  state: RateLimiterState,
  databaseLimiter: RateLimiter,
): RateLimiter {
  const lifetimeInterval = ""
  const lifetimeKey = buildRateLimitKey("ip", ip, lifetimeInterval)
  const dailyKey = buildRateLimitKey("ip", ip, dailyInterval)

  return {
    check: async () => {
      try {
        const keys = isDefaultModel
          ? [lifetimeKey, dailyKey]
          : [dailyKey]
        const counts = await redis.mget<(string | number | null)[]>(keys)
        const lifetimeCount = isDefaultModel ? Number(counts[0] ?? 0) : 0
        const dailyCount = Number(counts[isDefaultModel ? 1 : 0] ?? 0)
        logger.debug(`rate limit lifetime: ${lifetimeCount}, daily: ${dailyCount}`)

        state.isNew = isDefaultModel && lifetimeCount < dailyLimit * 7
        if ((state.isNew && dailyCount >= dailyLimit * 2) || (!state.isNew && dailyCount >= dailyLimit))
          throw new FreeUsageLimitError(dict["zen.api.error.rateLimitExceeded"], retryAfter)
      } catch (error) {
        if (error instanceof FreeUsageLimitError) throw error

        state.fallbackDatabase = true
        await databaseLimiter.check()
      }
    },
    track: async () => {
      if (state.fallbackDatabase) return databaseLimiter.track()

      try {
        const pipeline = redis.pipeline()
        pipeline.incr(dailyKey)
        pipeline.expire(dailyKey, retryAfter)
        if (state.isNew) pipeline.incr(lifetimeKey)
        await pipeline.exec()
      } catch {
        await databaseLimiter.track()
      }
    },
  }
}

function buildYYYYMMDD(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 8)
}
