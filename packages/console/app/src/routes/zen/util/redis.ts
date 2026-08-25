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

export async function checkRateLimit(kind: "checkout" | "workspace", identifier: string) {
  const redis = getRedis()
  const key = buildRateLimitKey(kind, identifier)
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, kind === "workspace" ? 24 * 60 * 60 : 60 * 60)
  if (count <= 5) return
  throw new Error(
    kind === "workspace"
      ? "Too many workspaces created. Please try again later."
      : "Too many payment attempts. Please try again later.",
  )
}
