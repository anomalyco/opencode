import { Database } from "@opencode-ai/core/database/database"
import { Assistant } from "@opencode-ai/core/v1/session"
import { MessageTable } from "@opencode-ai/core/session/sql"
import { lt } from "drizzle-orm"
import { Effect } from "effect"
import { MessageV2 } from "./message-v2"
import type * as SessionModule from "./session"

// Grace window: an active turn touches its message row on every event, so any
// row untouched this long when we boot belongs to a dead process.
const GRACE_MS = 60_000

type Sessions = Pick<SessionModule.Interface, "updateMessage">

export const recover = Effect.fn("SessionRecovery.recover")(function* (input: {
  db: Database.Interface["db"]
  sessions: Sessions
}) {
  const cutoff = Date.now() - GRACE_MS

  const rows = yield* input.db
    .select()
    .from(MessageTable)
    .where(lt(MessageTable.time_updated, cutoff))
    .all()
    .pipe(Effect.orDie)

  let recovered = 0
  for (const row of rows) {
    const data = row.data as Partial<Assistant> & {
      providerID?: string
      time?: { created?: number; completed?: number }
    }
    if (data.role !== "assistant") continue
    if (data.time?.completed !== undefined) continue
    if ((data.time?.created ?? Number.MAX_SAFE_INTEGER) >= cutoff) continue

    const completed = Date.now()
    const info = {
      ...data,
      error:
        data.error ??
        MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
          providerID: (data.providerID ?? "unknown") as Parameters<typeof MessageV2.fromError>[1]["providerID"],
          aborted: true,
        }),
      time: { ...data.time, completed },
    } as Assistant
    yield* input.sessions.updateMessage(info)
    recovered++
  }

  if (recovered > 0) {
    yield* Effect.logInfo("finalized interrupted assistant messages", { count: recovered })
  }
})

export * as SessionRecovery from "./recovery"
