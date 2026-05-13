import { WorkerEntrypoint } from "cloudflare:workers"
import { and, Database, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpsRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"

type Result = Record<string, { qualify: number; unqualify: number }>

export default class Stat extends WorkerEntrypoint {
  async fetch() {
    return new Response("Not Found", { status: 404 })
  }

  async getStats(ids: string[]): Promise<Result> {
    if (ids.length === 0) return {}

    const toInterval = (date: Date) =>
      parseInt(
        date
          .toISOString()
          .replace(/[^0-9]/g, "")
          .substring(0, 12),
      )
    const now = Date.now()
    const intervals = Array.from({ length: 5 }, (_, i) => toInterval(new Date(now - i * 60 * 1000)))

    const rows = await Database.use((tx) =>
      tx
        .select()
        .from(ModelTpsRateLimitTable)
        .where(and(inArray(ModelTpsRateLimitTable.id, ids), inArray(ModelTpsRateLimitTable.interval, intervals))),
    )

    const result: Result = Object.fromEntries(ids.map((id) => [id, { qualify: 0, unqualify: 0 }]))
    for (const row of rows) {
      result[row.id].qualify += row.qualify
      result[row.id].unqualify += row.unqualify
    }
    return result
  }
}
