import { Database } from "@opencode-ai/core/database/database"
import { MetricsTable } from "@opencode-ai/core/session/sql"
import { Effect } from "effect"
import { ulid } from "ulid"

export const recordToolMetrics = (input: {
  sessionID: string
  toolName: string
  cost: number
  tokensInput: number
  tokensOutput: number
}) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    yield* db
      .insert(MetricsTable)
      .values({
        id: ulid(),
        session_id: input.sessionID as any,
        tool_name: input.toolName,
        cost: input.cost,
        tokens_input: input.tokensInput,
        tokens_output: input.tokensOutput,
        time_created: Date.now(),
      })
      .run()
      .pipe(Effect.orDie)
  })
