import { Resource } from "@opencode-ai/console-resource"
import { RateLimitError } from "./error"
import { logger } from "./logger"

export function createRateLimiter(model: string, limit: number | undefined, ip: string) {
  if (!limit) return

  const now = Date.now()
  const currKey = `usage:${ip}:${model}:${buildYYYYMMDDHH(now)}`
  const prevKey = `usage:${ip}:${model}:${buildYYYYMMDDHH(now - 3_600_000)}`
  let currRate: number
  let prevRate: number

  return {
    track: async () => {
      await Resource.GatewayKv.put(currKey, currRate + 1, { expirationTtl: 3600 })
    },
    check: async () => {
      const values = await Resource.GatewayKv.get([currKey, prevKey])
      const prevValue = values?.get(prevKey)
      const currValue = values?.get(currKey)
      prevRate = prevValue ? parseInt(prevValue) : 0
      currRate = currValue ? parseInt(currValue) : 0
      logger.debug(`rate limit ${model} prev/curr: ${prevRate}/${currRate}`)
      if (prevRate + currRate >= limit) throw new RateLimitError(`Rate limit exceeded. Please try again later.`)
    },
  }
}

function buildYYYYMMDDHH(timestamp: number) {
  return new Date(timestamp)
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 10)
}
