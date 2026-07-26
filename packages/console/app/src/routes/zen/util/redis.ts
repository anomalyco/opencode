import { Resource } from "@opencode-ai/console-resource"
import { Redis } from "@upstash/redis/cloudflare"

let redis: Redis | undefined

export function getRedis() {
  if (redis) return redis
  redis = new Redis({
    url: Resource.UpstashRedisRestUrl.value,
    token: Resource.UpstashRedisRestToken.value,
    enableTelemetry: false,
  })
  return redis
}

export function buildRateLimitKey(kind: string, identifier: string, interval?: string) {
  return `${Resource.App.stage}:ratelimit:${kind}:${identifier}${interval ? `:${interval}` : ""}`
}
