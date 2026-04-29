import { Database, eq, and, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { KeyRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { RateLimitError } from "./error"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"

export function createRateLimiter(modelId: string, zenApiKey: string | undefined, request: Request) {
  if (!zenApiKey) return
  const dict = i18n(localeFromRequest(request))

  const LIMIT = 100
  const yyyyMMddHHmm = new Date(Date.now())
    .toISOString()
    .replace(/[^0-9]/g, "")
    .substring(0, 12)
  const interval = `${modelId.substring(0, 27)}-${yyyyMMddHHmm}`

  return {
    check: async () => {
      const rows = await Database.use((tx) =>
        tx
          .select({ interval: KeyRateLimitTable.interval, count: KeyRateLimitTable.count })
          .from(KeyRateLimitTable)
          .where(and(eq(KeyRateLimitTable.key, zenApiKey), eq(KeyRateLimitTable.interval, interval))),
      ).then((rows) => rows[0])
      const count = rows?.count ?? 0

      if (count >= LIMIT) throw new RateLimitError(dict["zen.api.error.rateLimitExceeded"], 60)
    },
    track: async () => {
      await Database.use((tx) =>
        tx
          .insert(KeyRateLimitTable)
          .values({ key: zenApiKey, interval, count: 1 })
          .onDuplicateKeyUpdate({ set: { count: sql`${KeyRateLimitTable.count} + 1` } }),
      )
    },
  }
}
