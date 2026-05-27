import { RateLimitError } from "./error"
import { buildRateLimitKey, getRedis } from "./redis"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"

export function createRateLimiter(
  modelId: string,
  rateLimit: number | undefined,
  zenApiKey: string | undefined,
  request: Request,
) {
  if (!zenApiKey) return
  const dict = i18n(localeFromRequest(request))

  const LIMIT = rateLimit ?? 1000
  const yyyyMMddHHmm = new Date(Date.now())
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 12)
  const interval = `${modelId.substring(0, 27)}-${yyyyMMddHHmm}`
  const redis = getRedis()
  const key = buildRateLimitKey("key", zenApiKey, interval)

  return {
    check: async () => {
      const count = Number((await redis.mget<(string | number | null)[]>([key]))[0] ?? 0)

      if (count >= LIMIT) throw new RateLimitError(dict["zen.api.error.rateLimitExceeded"], 60)
    },
    track: async () => {
      const pipeline = redis.pipeline()
      pipeline.incr(key)
      pipeline.expire(key, 60)
      await pipeline.exec()
    },
  }
}
