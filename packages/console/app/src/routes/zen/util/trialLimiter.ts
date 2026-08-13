import { Database, eq, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { IpTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"
import { Subscription } from "@opencode-ai/console-core/subscription.js"

export function createTrialLimiter(trialProviders: string[] | undefined, ip: string) {
  if (!trialProviders) return
  if (!ip) return

  const limit = Subscription.getFreeLimits().promoTokens

  let _isTrial: boolean

  return {
    check: async () => {
      const data = await Database.use((tx) =>
        tx
          .select({
            usage: IpTable.usage,
          })
          .from(IpTable)
          .where(eq(IpTable.ip, ip))
          .then((rows) => rows[0]),
      )

      _isTrial = (data?.usage ?? 0) < limit
      return _isTrial ? trialProviders : undefined
    },
    track: async (usageInfo: UsageInfo) => {
      if (!_isTrial) return
      const usage =
        usageInfo.inputTokens +
        usageInfo.outputTokens +
        (usageInfo.reasoningTokens ?? 0) +
        (usageInfo.cacheReadTokens ?? 0) +
        (usageInfo.cacheWrite5mTokens ?? 0) +
        (usageInfo.cacheWrite1hTokens ?? 0)
      await Database.use((tx) =>
        tx
          .insert(IpTable)
          .values({ ip, usage })
          .onDuplicateKeyUpdate({ set: { usage: sql`${IpTable.usage} + ${usage}` } }),
      )
    },
  }
}
