export * as SessionTurnStore from "./turn.js"

import { and, eq } from "drizzle-orm"
import { Effect } from "effect"
import { Money } from "@opencode/schema/money"
import { SessionTurn } from "@opencode/schema/session-turn"
import type { TokenUsage } from "@opencode/schema/token-usage"
import type { Database } from "../database/database.js"
import type { Bus } from "../bus.js"
import { SessionEvent } from "./event.js"
import type { SessionSchema } from "./schema.js"
import { SessionMessage } from "./message.js"
import { SessionTurnTable } from "./sql.js"

type DB = Database.Interface["db"]
const zero = { cost: Money.USD.make(0), tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }
const running = (sessionID: SessionSchema.ID) =>
  and(eq(SessionTurnTable.session_id, sessionID), eq(SessionTurnTable.status, "running"))

export const get = Effect.fn("SessionTurn.get")(function* (
  db: DB,
  input: { sessionID: SessionSchema.ID; inputID: SessionMessage.ID },
): Effect.fn.Return<SessionTurn.Info | undefined> {
  const row = yield* db
    .select()
    .from(SessionTurnTable)
    .where(and(eq(SessionTurnTable.id, input.inputID), eq(SessionTurnTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie)
  return row ? { ...input, ...(row.data ?? { status: "pending" as const }) } : undefined
})

export const cancel = (db: DB, sessionID: SessionSchema.ID, inputID: SessionMessage.ID) =>
  db
    .update(SessionTurnTable)
    .set({ status: "interrupted", data: { ...zero, turnID: inputID, status: "interrupted", reason: "cancelled" } })
    .where(
      and(
        eq(SessionTurnTable.session_id, sessionID),
        eq(SessionTurnTable.id, inputID),
        eq(SessionTurnTable.status, "pending"),
      ),
    )
    .run()
    .pipe(Effect.orDie)

/** One compact result per input. All running inputs belong to the same turn and update together. */
export const project = Effect.fn("SessionTurn.project")(function* (db: DB, bus: Bus.Interface) {
  const active = (sessionID: SessionSchema.ID) =>
    db.select().from(SessionTurnTable).where(running(sessionID)).get().pipe(Effect.orDie)
  const save = (sessionID: SessionSchema.ID, data: SessionTurn.Result) =>
    db.update(SessionTurnTable).set({ status: data.status, data }).where(running(sessionID)).run().pipe(Effect.orDie)
  const finish = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    outcome:
      | { status: "settled" }
      | { status: "failed"; error: Extract<SessionTurn.Result, { status: "failed" }>["error"] }
      | { status: "interrupted"; reason: Extract<SessionTurn.Result, { status: "interrupted" }>["reason"] },
  ) {
    const row = yield* active(sessionID)
    if (row?.data) yield* save(sessionID, { ...row.data, ...outcome })
  })
  const usage = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, cost: number, tokens: TokenUsage.Info) {
    const row = yield* active(sessionID)
    if (!row?.data) return
    yield* save(sessionID, {
      ...row.data,
      cost: Money.USD.make(row.data.cost + cost),
      tokens: {
        input: row.data.tokens.input + tokens.input,
        output: row.data.tokens.output + tokens.output,
        reasoning: row.data.tokens.reasoning + tokens.reasoning,
        cache: {
          read: row.data.tokens.cache.read + tokens.cache.read,
          write: row.data.tokens.cache.write + tokens.cache.write,
        },
      },
    })
  })
  yield* bus.project(SessionEvent.InboxEnqueued, (event) => {
    if (event.data.item.type !== "user" && event.data.item.type !== "synthetic") return Effect.void
    // A genuinely new admission may reuse a cancelled/reverted ID. Normal retries never enqueue again.
    return db
      .insert(SessionTurnTable)
      .values({ id: event.data.inboxID, session_id: event.data.sessionID, status: "pending" })
      .onConflictDoUpdate({
        target: SessionTurnTable.id,
        set: { session_id: event.data.sessionID, status: "pending", data: null },
      })
      .run()
      .pipe(Effect.orDie)
  })
  yield* bus.project(SessionEvent.InboxDelivered, (event) =>
    Effect.gen(function* () {
      const row = yield* active(event.data.sessionID)
      yield* db
        .update(SessionTurnTable)
        .set({
          status: "running",
          data: row?.data ?? { ...zero, turnID: SessionMessage.ID.fromEvent(event.id), status: "running" },
        })
        .where(and(eq(SessionTurnTable.id, event.data.inboxID), eq(SessionTurnTable.status, "pending")))
        .run()
        .pipe(Effect.orDie)
    }),
  )
  yield* bus.project(SessionEvent.InboxCancelled, (event) => cancel(db, event.data.sessionID, event.data.inboxID))
  yield* bus.project(SessionEvent.Step.Started, (event) =>
    Effect.gen(function* () {
      const row = yield* active(event.data.sessionID)
      if (row?.data)
        yield* save(event.data.sessionID, { ...row.data, assistantMessageID: event.data.assistantMessageID })
    }),
  )
  yield* bus.project(SessionEvent.Step.Ended, (event) =>
    usage(event.data.sessionID, event.data.cost, event.data.tokens),
  )
  yield* bus.project(SessionEvent.Step.Failed, (event) =>
    event.data.cost !== undefined && event.data.tokens !== undefined
      ? usage(event.data.sessionID, event.data.cost, event.data.tokens)
      : Effect.void,
  )
  yield* bus.project(SessionEvent.TurnSettled, (event) => finish(event.data.sessionID, { status: "settled" }))
  yield* bus.project(SessionEvent.Execution.Succeeded, (event) => finish(event.data.sessionID, { status: "settled" }))
  yield* bus.project(SessionEvent.Execution.Failed, (event) =>
    finish(event.data.sessionID, { status: "failed", error: event.data.error }),
  )
  yield* bus.project(SessionEvent.Execution.Interrupted, (event) =>
    event.data.reason === "shutdown"
      ? Effect.void
      : finish(event.data.sessionID, { status: "interrupted", reason: event.data.reason }),
  )
})
