import { and, Database, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpsRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"

type Entry = { provider: string; model: string; tps: number }
type Result = Record<string, { qualify: number; unqualify: number }>

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

    const entries = (await request.json()) as Entry[]
    if (!Array.isArray(entries) || entries.length === 0) return Response.json({} satisfies Result)

    const ids = entries.map((e) => `${e.provider}/${e.model}/${e.tps}`)

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
    return Response.json(result)
  },
}
