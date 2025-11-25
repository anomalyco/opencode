import { Database, eq, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { IpTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"

export function createTrialLimiter(limit: number | undefined, ip: string) {
  if (!limit) return
  if (!ip) return

  let trial: boolean

  return {
    isTrial: async () => {
      const data = await Database.use((tx) =>
        tx
          .select({
            usage: IpTable.usage,
          })
          .from(IpTable)
          .where(eq(IpTable.ip, ip))
          .then((rows) => rows[0]),
      )

      trial = (data?.usage ?? 0) < limit
      return trial
    },
    track: async (usageInfo: UsageInfo) => {
      if (!trial) return
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
