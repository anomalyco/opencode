import { Resource } from "@opencode-ai/console-resource"
import { Redis } from "@upstash/redis/cloudflare"

export const redis = new Redis({
  url: Resource.UpstashRedisRestUrl.value,
  token: Resource.UpstashRedisRestToken.value,
  enableTelemetry: false,
})

export function buildRateLimitKey(kind: string, identifier: string, interval?: string) {
  return `${Resource.App.stage}:ratelimit:${kind}:${identifier}${interval ? `:${interval}` : ""}`
}
