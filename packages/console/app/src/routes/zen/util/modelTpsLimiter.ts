import { and, Database, inArray, sql } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpsRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"
import { UsageInfo } from "./provider/provider"

export function createModelTpsLimiter(providers: { id: string; model: string; tpsGoal?: number }[]) {
  const tpsGoals = Object.fromEntries(
    providers.flatMap((p) => {
      return p.tpsGoal ? [[`${p.id}/${p.model}/${p.tpsGoal}`, p.tpsGoal]] : []
    }),
  )
  const ids = Object.keys(tpsGoals)
  if (ids.length === 0) return

  const toInterval = (date: Date) =>
    parseInt(
      date
        .toISOString()
        .replace(/[^0-9]/g, "")
        .substring(0, 12),
    )
  const now = Date.now()
  const currInterval = toInterval(new Date(now))
  const prevInterval = toInterval(new Date(now - 60 * 1000))

  return {
    check: async () => {
      const data = await Database.use((tx) =>
        tx
          .select()
          .from(ModelTpsRateLimitTable)
          .where(
            and(
              inArray(ModelTpsRateLimitTable.id, ids),
              inArray(ModelTpsRateLimitTable.interval, [currInterval, prevInterval]),
            ),
          ),
      )

      // convert to map of model to summed count across current and previous intervals
      const result = data.reduce(
        (acc, curr) => {
          const existing = acc[curr.id] ?? { qualify: 0, unqualify: 0 }
          acc[curr.id] = {
            qualify: existing.qualify + curr.qualify,
            unqualify: existing.unqualify + curr.unqualify,
          }
          return acc
        },
        {} as Record<string, { qualify: number; unqualify: number }>,
      )

      return Object.fromEntries(
        Object.entries(result).map(([id, { qualify, unqualify }]) => {
          const isLowTps = qualify + unqualify > 10 && qualify < unqualify
          return [id, isLowTps]
        }),
      )
    },
    track: async (
      provider: string,
      model: string,
      tpsGoal: number | undefined,
      tsFirstByte: number,
      tsLastByte: number,
      usageInfo: UsageInfo,
    ) => {
      if (!tpsGoal) return
      const id = `${provider}/${model}/${tpsGoal}`
      if (!ids.includes(id)) return
      if (tsFirstByte <= 0 || tsLastByte <= 0) return
      const tokens = usageInfo.outputTokens
      if (tokens <= 10) return

      const tps = (tokens / (tsLastByte - tsFirstByte)) * 1000
      const qualify = tps >= tpsGoal ? 1 : 0
      const unqualify = tps < tpsGoal ? 1 : 0
      await Database.use((tx) =>
        tx
          .insert(ModelTpsRateLimitTable)
          .values({
            id,
            interval: currInterval,
            qualify,
            unqualify,
          })
          .onDuplicateKeyUpdate({
            set: {
              qualify: sql`${ModelTpsRateLimitTable.qualify} + ${qualify}`,
              unqualify: sql`${ModelTpsRateLimitTable.unqualify} + ${unqualify}`,
            },
          }),
      )
    },
  }
}
