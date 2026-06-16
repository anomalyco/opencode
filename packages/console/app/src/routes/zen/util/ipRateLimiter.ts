import { FreeUsageLimitError } from "./error"
import { logger } from "./logger"
import { buildRateLimitKey, getRedis } from "./redis"
import { i18n } from "~/i18n"
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
  const redis = getRedis()
  const lifetimeKey = buildRateLimitKey("ip", ip)
  const dailyKey = buildRateLimitKey("ip", ip, dailyInterval)
  let isNew = false

  return {
    check: async () => {
      const counts = await redis.mget<(string | number | null)[]>(isDefaultModel ? [lifetimeKey, dailyKey] : [dailyKey])
      const lifetimeCount = isDefaultModel ? Number(counts[0] ?? 0) : 0
      const dailyCount = Number(counts[isDefaultModel ? 1 : 0] ?? 0)
      logger.debug(`rate limit lifetime: ${lifetimeCount}, daily: ${dailyCount}`)

      isNew = isDefaultModel && lifetimeCount < dailyLimit * 7

      if ((isNew && dailyCount >= dailyLimit * 2) || (!isNew && dailyCount >= dailyLimit))
        throw new FreeUsageLimitError(dict["zen.api.error.rateLimitExceeded"], retryAfter)
    },
    track: async () => {
      const pipeline = redis.pipeline()
      pipeline.incr(dailyKey)
      pipeline.expire(dailyKey, retryAfter)
      if (isNew) pipeline.incr(lifetimeKey)
      await pipeline.exec()
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
