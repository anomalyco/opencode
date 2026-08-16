import type { APIEvent } from "@solidjs/start/server"
import { Database } from "@opencode-ai/console-core/drizzle/index.js"
import { BenchmarkTable } from "@opencode-ai/console-core/schema/benchmark.sql.js"
import { Identifier } from "@opencode-ai/console-core/identifier.js"
import { i18n } from "~/i18n"
import { localeFromRequest } from "~/lib/language"

interface SubmissionBody {
  model: string
  agent: string
  result: string
}

export async function POST(event: APIEvent) {
  const dict = i18n(localeFromRequest(event.request))
  const body = (await event.request.json()) as SubmissionBody

  if (!body.model || !body.agent || !body.result) {
    return Response.json({ error: dict["bench.submission.error.allFieldsRequired"] }, { status: 400 })
  }

  await Database.use((tx) =>
    tx.insert(BenchmarkTable).values({
      id: Identifier.create("benchmark"),
      model: body.model,
      agent: body.agent,
      result: body.result,
    }),
  )

  return Response.json({ success: true }, { status: 200 })
}
