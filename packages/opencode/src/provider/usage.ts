import z from "zod"
import { MessageV2 } from "../session/message-v2"
import { MessageTable } from "../session/session.sql"
import { Database, desc } from "../storage/db"
import { ProviderID } from "./schema"

export namespace ProviderUsage {
  export const Info = z.object({
    state: z.enum(["fresh", "stale", "missing"]),
    observedAt: z.string().optional(),
    ageMinutes: z.number().optional(),
    recentInputTokens: z.number().optional(),
    recentOutputTokens: z.number().optional(),
  })

  export type Info = z.infer<typeof Info>

  const stale = 60 * 60 * 1000

  export function summarize(
    rows: { data: unknown; time_created: number }[],
    now = Date.now(),
  ): Record<ProviderID, Info> {
    const map = rows.reduce(
      (acc, row) => {
        const parsed = MessageV2.Info.safeParse(row.data)
        if (!parsed.success) return acc
        if (parsed.data.role !== "assistant") return acc
        const item = acc[parsed.data.providerID]
        if (item) {
          item.time = Math.max(item.time, row.time_created)
          item.input += parsed.data.tokens.input
          item.output += parsed.data.tokens.output
          return acc
        }
        acc[parsed.data.providerID] = {
          time: row.time_created,
          input: parsed.data.tokens.input,
          output: parsed.data.tokens.output,
        }
        return acc
      },
      {} as Record<ProviderID, { time: number; input: number; output: number }>,
    )

    return Object.fromEntries(
      Object.entries(map).map(([id, item]) => {
        const age = Math.max(0, Math.floor((now - item.time) / 60_000))
        return [
          id,
          {
            state: now - item.time > stale ? "stale" : "fresh",
            observedAt: new Date(item.time).toISOString(),
            ageMinutes: age,
            recentInputTokens: item.input,
            recentOutputTokens: item.output,
          } satisfies Info,
        ]
      }),
    ) as Record<ProviderID, Info>
  }

  export async function list(limit = 200) {
    const rows = Database.use((db) =>
      db
        .select({
          data: MessageTable.data,
          time_created: MessageTable.time_created,
        })
        .from(MessageTable)
        .orderBy(desc(MessageTable.time_created))
        .limit(limit)
        .all(),
    )
    return summarize(rows)
  }
}
