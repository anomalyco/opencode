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
import type { SessionMessage } from "./message.js"
import { SessionTurnInputTable, SessionTurnTable } from "./sql.js"

type DB = Database.Interface["db"]
const zero = { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }

/** Recovery may acknowledge a removed notification, but never a cross-type or cross-session conflict. */
export const hasSynthetic = (db: DB, sessionID: SessionSchema.ID, inputID: SessionMessage.ID) =>
  db
    .select({ id: SessionTurnInputTable.id })
    .from(SessionTurnInputTable)
    .where(
      and(
        eq(SessionTurnInputTable.id, inputID),
        eq(SessionTurnInputTable.session_id, sessionID),
        eq(SessionTurnInputTable.type, "synthetic"),
      ),
    )
    .get()
    .pipe(
      Effect.orDie,
      Effect.map((row) => row !== undefined),
    )

export const get = Effect.fn("SessionTurn.get")(function* (
  db: DB,
  input: { sessionID: SessionSchema.ID; inputID: SessionMessage.ID },
): Effect.fn.Return<SessionTurn.Info | undefined> {
  const row = yield* db
    .select()
    .from(SessionTurnInputTable)
    .leftJoin(SessionTurnTable, eq(SessionTurnInputTable.turn_id, SessionTurnTable.id))
    .where(and(eq(SessionTurnInputTable.id, input.inputID), eq(SessionTurnInputTable.session_id, input.sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!row) return undefined
  return { ...input, ...(row.session_turn?.data ?? { status: "pending" as const }) }
})

/** Cancellation and history reversion both retire unconsumed inputs without changing an active turn. */
export const cancel = Effect.fn("SessionTurn.cancel")(function* (
  db: DB,
  sessionID: SessionSchema.ID,
  inputID: SessionMessage.ID,
) {
  const input = yield* db
    .select()
    .from(SessionTurnInputTable)
    .where(and(eq(SessionTurnInputTable.id, inputID), eq(SessionTurnInputTable.session_id, sessionID)))
    .get()
    .pipe(Effect.orDie)
  if (!input || input.turn_id) return
  yield* db
    .insert(SessionTurnTable)
    .values({
      id: input.id,
      session_id: sessionID,
      status: "interrupted",
      data: {
        turnID: input.id,
        inputIDs: [input.id],
        status: "interrupted",
        reason: "cancelled",
        cost: Money.USD.make(0),
        tokens: zero,
      },
    })
    .run()
    .pipe(Effect.orDie)
  yield* db
    .update(SessionTurnInputTable)
    .set({ turn_id: input.id })
    .where(eq(SessionTurnInputTable.id, input.id))
    .run()
    .pipe(Effect.orDie)
})

/** Called with the other projectors: these writes share the event's transaction even without retained events. */
export const project = Effect.fn("SessionTurn.project")(function* (db: DB, bus: Bus.Interface) {
  const active = (sessionID: SessionSchema.ID) =>
    db
      .select()
      .from(SessionTurnTable)
      .where(and(eq(SessionTurnTable.session_id, sessionID), eq(SessionTurnTable.status, "running")))
      .get()
      .pipe(Effect.orDie)
  const save = (data: SessionTurn.Result) =>
    db
      .update(SessionTurnTable)
      .set({ status: data.status, data })
      .where(eq(SessionTurnTable.id, data.turnID))
      .run()
      .pipe(Effect.orDie)
  const finish = Effect.fnUntraced(function* (
    sessionID: SessionSchema.ID,
    outcome:
      | { status: "settled" }
      | { status: "failed"; error: Extract<SessionTurn.Result, { status: "failed" }>["error"] }
      | { status: "interrupted"; reason: Extract<SessionTurn.Result, { status: "interrupted" }>["reason"] },
  ) {
    const row = yield* active(sessionID)
    if (row) yield* save({ ...row.data, ...outcome })
  })
  const usage = Effect.fnUntraced(function* (sessionID: SessionSchema.ID, cost: number, tokens: TokenUsage.Info) {
    const row = yield* active(sessionID)
    if (!row) return
    yield* save({
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
    return db
      .insert(SessionTurnInputTable)
      .values({ id: event.data.inboxID, session_id: event.data.sessionID, type: event.data.item.type })
      .run()
      .pipe(Effect.orDie)
  })
  yield* bus.project(SessionEvent.InboxDelivered, (event) =>
    Effect.gen(function* () {
      const input = yield* db
        .select()
        .from(SessionTurnInputTable)
        .where(eq(SessionTurnInputTable.id, event.data.inboxID))
        .get()
        .pipe(Effect.orDie)
      // Controls and inputs admitted before this projection existed have no binding.
      if (!input || input.turn_id) return
      const row = yield* active(event.data.sessionID)
      const turnID = row?.id ?? input.id
      if (row) yield* save({ ...row.data, inputIDs: [...row.data.inputIDs, input.id] })
      if (!row)
        yield* db
          .insert(SessionTurnTable)
          .values({
            id: turnID,
            session_id: event.data.sessionID,
            status: "running",
            data: { turnID, inputIDs: [input.id], status: "running", cost: Money.USD.make(0), tokens: zero },
          })
          .run()
          .pipe(Effect.orDie)
      yield* db
        .update(SessionTurnInputTable)
        .set({ turn_id: turnID })
        .where(eq(SessionTurnInputTable.id, input.id))
        .run()
        .pipe(Effect.orDie)
    }),
  )
  yield* bus.project(SessionEvent.InboxCancelled, (event) => cancel(db, event.data.sessionID, event.data.inboxID))
  yield* bus.project(SessionEvent.Step.Started, (event) =>
    Effect.gen(function* () {
      const row = yield* active(event.data.sessionID)
      if (row) yield* save({ ...row.data, assistantMessageID: event.data.assistantMessageID })
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
  // Title and background compaction may finish during a different turn. They remain
  // session overhead until their usage records carry source-turn attribution.
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
