import { and, Database, inArray } from "@opencode-ai/console-core/drizzle/index.js"
import { ModelTpsRateLimitTable } from "@opencode-ai/console-core/schema/ip.sql.js"

type Result = Record<string, Record<number, { qualify: number; unqualify: number }>>

export default {
  async fetch(request: Request) {
    if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 })

    const body = (await request.json()) as { ids: string[] }
    const ids = body.ids

    if (ids.length === 0) return Response.json({} satisfies Result)

    const toInterval = (date: Date) =>
      parseInt(
        date
          .toISOString()
          .replace(/[^0-9]/g, "")
          .substring(0, 12),
      )
    const now = Date.now()
    const intervals = Array.from({ length: 30 }, (_, i) => toInterval(new Date(now - i * 60 * 1000)))

    const rows = await Database.use((tx) =>
      tx
        .select()
        .from(ModelTpsRateLimitTable)
        .where(and(inArray(ModelTpsRateLimitTable.id, body.ids), inArray(ModelTpsRateLimitTable.interval, intervals))),
    )

    const result: Result = Object.fromEntries(
      body.ids.map((id) => [
        id,
        Object.fromEntries(intervals.map((interval) => [interval, { qualify: 0, unqualify: 0 }])),
      ]),
    )
    for (const row of rows) {
      result[row.id][row.interval] = { qualify: row.qualify, unqualify: row.unqualify }
    }
    return Response.json(result)
  },
}
