import { Database, eq, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { IpTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"
import { ZenData } from "@opencode-ai/console-core/model.js"

export function createTrialLimiter(trial: ZenData.Trial | undefined, ip: string, client: string) {
  if (!trial) return
  if (!ip) return

  const limit =
    trial.limits.find((limit) => limit.client === client)?.limit ??
    trial.limits.find((limit) => limit.client === undefined)?.limit
  if (!limit) return

  let _isTrial: boolean

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

      _isTrial = (data?.usage ?? 0) < limit
      return _isTrial
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
