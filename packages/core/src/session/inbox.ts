export * as SessionInbox from "./inbox.js"

import { and, asc, eq, or } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { makeGlobalNode } from "@opencode-ai/util/effect/app-node"
import {
  Compaction,
  CompactionPayload,
  Delivery,
  Info,
  Item,
  Move,
  MovePayload,
  Synthetic,
  SyntheticPayload,
  User,
  UserPayload,
} from "@opencode-ai/schema/session-inbox"
import { Database } from "../database/database.js"
import { Bus } from "../bus.js"
import { KeyedMutex } from "../effect/keyed-mutex.js"
import { SessionEvent } from "./event.js"
import { SessionMessage } from "./message.js"
import { SessionSchema } from "./schema.js"
import { SessionInboxTable, SessionMessageTable } from "./sql.js"

type DatabaseService = Database.Interface["db"]

export {
  Compaction,
  CompactionPayload,
  Delivery,
  Info,
  Item,
  Move,
  MovePayload,
  Synthetic,
  SyntheticPayload,
  User,
  UserPayload,
}

/**
 * Which pending input `promote` may consume: "steer" promotes steers only (a step
 * boundary mid-work), while "input" also allows one queued input when no steers are
 * waiting (the idle boundary, where the Session picks up fresh work).
 */
export type Promotable = "input" | "steer"

const decodeUser = Schema.decodeUnknownSync(UserPayload)
const encodeUser = Schema.encodeSync(UserPayload)
const decodeSynthetic = Schema.decodeUnknownSync(SyntheticPayload)
const encodeSynthetic = Schema.encodeSync(SyntheticPayload)
const decodeCompaction = Schema.decodeUnknownSync(CompactionPayload)
const encodeCompaction = Schema.encodeSync(CompactionPayload)
const decodeMove = Schema.decodeUnknownSync(MovePayload)
const encodeMove = Schema.encodeSync(MovePayload)
const decodeMessage = Schema.decodeUnknownSync(SessionMessage.Info)
const inboxLocks = KeyedMutex.makeUnsafe<SessionSchema.ID>()
type PendingRef = { readonly id: SessionMessage.ID; readonly sessionID: SessionSchema.ID }

export const serialized = <A, E, R>(sessionID: SessionSchema.ID, effect: Effect.Effect<A, E, R>) =>
  inboxLocks.withLock(sessionID)(effect)

export class LifecycleConflict extends Schema.TaggedError<LifecycleConflict>()("SessionInbox.LifecycleConflict", {
  id: SessionMessage.ID,
}) {}

function matches<Type extends Item["type"]>(
  stored: Info,
  request: PendingRef & { readonly type: Type },
): stored is Extract<Info, { readonly type: Type }> {
  return stored.sessionID === request.sessionID && stored.type === request.type
}

const fromRow = (row: typeof SessionInboxTable.$inferSelect): Info => {
  const base = {
    id: SessionMessage.ID.make(row.id),
    sessionID: SessionSchema.ID.make(row.session_id),
    timeCreated: DateTime.makeUnsafe(row.time_created),
  }
  if (row.type === "compaction")
    return Compaction.make({
      ...base,
      type: "compaction",
      payload: decodeCompaction(row.payload),
      delivery: row.delivery,
    })
  if (row.type === "move")
    return Move.make({ ...base, type: "move", payload: decodeMove(row.payload), delivery: row.delivery })
  if (row.type === "user")
    return User.make({
      ...base,
      type: "user",
      payload: decodeUser(row.payload),
      delivery: row.delivery,
    })
  if (row.type === "synthetic")
    return Synthetic.make({
      ...base,
      type: "synthetic",
      payload: decodeSynthetic(row.payload),
      delivery: row.delivery,
    })
  throw new LifecycleConflict({ id: base.id })
}

export const find = Effect.fn("SessionInbox.find")(function* (db: DatabaseService, id: SessionMessage.ID) {
  const row = yield* db.select().from(SessionInboxTable).where(eq(SessionInboxTable.id, id)).get().pipe(Effect.orDie)
  return row === undefined ? undefined : fromRow(row)
})

const promotedFromMessage = Effect.fn("SessionInbox.promotedFromMessage")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  id: SessionMessage.ID,
  delivery: Delivery,
) {
  const row = yield* db
    .select()
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, id))
    .get()
    .pipe(Effect.orDie)
  if (row === undefined) return undefined
  if (row.session_id !== sessionID || (row.type !== "user" && row.type !== "synthetic"))
    return yield* new LifecycleConflict({ id })
  const message = decodeMessage({ ...row.data, id: row.id, type: row.type })
  const base = { id, sessionID, timeCreated: message.time.created, delivery }
  if (message.type === "user")
    return User.make({
      ...base,
      type: "user",
      payload: decodeUser(message),
    })
  if (message.type === "synthetic")
    return Synthetic.make({
      ...base,
      type: "synthetic",
      payload: decodeSynthetic(message),
    })
  return yield* new LifecycleConflict({ id })
})

export type Interface = Effect.Success<ReturnType<typeof make>>

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionInbox") {}

export const make = Effect.fn("SessionInbox.make")(function* () {
  const database = yield* Database.Service
  const db = database.db
  const bus = yield* Bus.Service

  /** First admission wins for matching Session and type, without preparing a new payload. */
  const reconcile = Effect.fn("SessionInbox.reconcile")(function* <Type extends Item["type"]>(request: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly type: Type
    readonly delivery: Delivery
  }) {
    const existing =
      (yield* find(db, request.id)) ?? (yield* promotedFromMessage(db, request.sessionID, request.id, request.delivery))
    if (existing === undefined) return undefined
    if (existing.type === "compaction" || !matches(existing, request))
      return yield* new LifecycleConflict({ id: request.id })
    return existing
  })

  const admit = Effect.fn("SessionInbox.admit")(function* <Type extends Item["type"]>(request: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly item: Item & { readonly type: Type }
  }) {
    const existing = yield* reconcile({ ...request, type: request.item.type, delivery: request.item.delivery })
    if (existing !== undefined) return existing
    const admitted = yield* bus
      .publish(SessionEvent.InboxEnqueued, {
        inboxID: request.id,
        sessionID: request.sessionID,
        item: request.item,
      })
      .pipe(
        Effect.map((event) =>
          Info.make({
            id: request.id,
            sessionID: request.sessionID,
            timeCreated: DateTime.makeUnsafe(event.created),
            ...request.item,
          }),
        ),
        Effect.catchDefect((defect) =>
          defect instanceof LifecycleConflict
            ? find(db, request.id).pipe(
                Effect.flatMap((stored) => (stored === undefined ? Effect.fail(defect) : Effect.succeed(stored))),
              )
            : Effect.die(defect),
        ),
      )
    if (!matches(admitted, { ...request, type: request.item.type }))
      return yield* new LifecycleConflict({ id: request.id })
    return admitted
  })

  const admitCompaction = Effect.fn("SessionInbox.admitCompaction")(function* (input: {
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly delivery: Delivery
  }) {
    return yield* serialized(
      input.sessionID,
      Effect.gen(function* () {
        const exact = yield* find(db, input.id)
        if (exact) {
          if (exact.type === "compaction" && exact.sessionID === input.sessionID) return exact
          return yield* new LifecycleConflict({ id: input.id })
        }
        if (yield* promotedFromMessage(db, input.sessionID, input.id, input.delivery))
          return yield* new LifecycleConflict({ id: input.id })
        const pending = (yield* list(db, input.sessionID)).find((item) => item.type === "compaction")
        if (pending) return pending
        return yield* admit({
          id: input.id,
          sessionID: input.sessionID,
          item: { type: "compaction", payload: {}, delivery: Delivery.make(input.delivery) },
        })
      }),
    )
  })

  const cancel = Effect.fn("SessionInbox.cancel")((input: PendingRef) =>
    publishMutation(
      input,
      bus.publish(SessionEvent.InboxCancelled, {
        sessionID: input.sessionID,
        inboxID: input.id,
      }),
    ),
  )

  const steer = Effect.fn("SessionInbox.steer")((input: PendingRef) =>
    publishMutation(
      input,
      bus.publish(SessionEvent.InboxDeliveryChanged, {
        sessionID: input.sessionID,
        inboxID: input.id,
        delivery: "steer",
      }),
    ),
  )

  const queue = Effect.fn("SessionInbox.queue")((input: PendingRef) =>
    publishMutation(
      input,
      bus.publish(SessionEvent.InboxDeliveryChanged, {
        sessionID: input.sessionID,
        inboxID: input.id,
        delivery: "queue",
      }),
    ),
  )

  return {
    list: (sessionID: SessionSchema.ID) => list(db, sessionID),
    reconcile,
    admit,
    admitCompaction,
    cancel,
    steer,
    queue,
  }
})

export const layer = Layer.effect(Service, make())

export const node = makeGlobalNode({ service: Service, layer, deps: [Database.node, Bus.node] })

export const projectAdmitted = Effect.fn("SessionInbox.projectAdmitted")(function* (
  db: DatabaseService,
  request: {
    readonly enqueuedSeq: number
    readonly id: SessionMessage.ID
    readonly sessionID: SessionSchema.ID
    readonly item: Item
    readonly timeCreated: number
  },
) {
  const message = yield* db
    .select({ id: SessionMessageTable.id })
    .from(SessionMessageTable)
    .where(eq(SessionMessageTable.id, request.id))
    .get()
    .pipe(Effect.orDie)
  if (message !== undefined) return yield* Effect.die(new LifecycleConflict({ id: request.id }))
  const stored = yield* db
    .insert(SessionInboxTable)
    .values({
      id: request.id,
      session_id: request.sessionID,
      type: request.item.type,
      payload:
        request.item.type === "user"
          ? encodeUser(request.item.payload)
          : request.item.type === "synthetic"
            ? encodeSynthetic(request.item.payload)
            : request.item.type === "compaction"
              ? encodeCompaction(request.item.payload)
              : encodeMove(request.item.payload),
      delivery: request.item.delivery,
      enqueued_seq: request.enqueuedSeq,
      time_created: request.timeCreated,
    })
    .onConflictDoNothing()
    .returning({ id: SessionInboxTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!stored) return yield* Effect.die(new LifecycleConflict({ id: request.id }))
})

/**
 * Consume one pending row at promotion. The row's content feeds the projected
 * message insert inside the same event transaction; the deleted row is what
 * makes the table pending-only.
 */
export const projectDelivered = Effect.fn("SessionInbox.projectDelivered")(function* (
  db: DatabaseService,
  input: PendingRef,
) {
  const deleted = yield* db
    .delete(SessionInboxTable)
    .where(and(eq(SessionInboxTable.id, input.id), eq(SessionInboxTable.session_id, input.sessionID)))
    .returning()
    .get()
    .pipe(Effect.orDie)
  if (!deleted) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
  return fromRow(deleted)
})

export const projectCancelled = Effect.fn("SessionInbox.projectCancelled")(function* (
  db: DatabaseService,
  input: PendingRef,
) {
  const deleted = yield* db
    .delete(SessionInboxTable)
    .where(
      and(
        eq(SessionInboxTable.id, input.id),
        eq(SessionInboxTable.session_id, input.sessionID),
        or(eq(SessionInboxTable.delivery, "queue"), eq(SessionInboxTable.delivery, "steer")),
      ),
    )
    .returning({ id: SessionInboxTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!deleted) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

const projectDelivery = Effect.fn("SessionInbox.projectDelivery")(function* (
  db: DatabaseService,
  input: PendingRef & { readonly from: Delivery; readonly to: Delivery },
) {
  const updated = yield* db
    .update(SessionInboxTable)
    .set({ delivery: input.to })
    .where(
      and(
        eq(SessionInboxTable.id, input.id),
        eq(SessionInboxTable.session_id, input.sessionID),
        eq(SessionInboxTable.delivery, input.from),
      ),
    )
    .returning({ id: SessionInboxTable.id })
    .get()
    .pipe(Effect.orDie)
  if (!updated) return yield* Effect.die(new LifecycleConflict({ id: input.id }))
})

export const projectDeliveryChanged = Effect.fn("SessionInbox.projectDeliveryChanged")(
  (db: DatabaseService, input: PendingRef & { readonly delivery: Delivery }) =>
    projectDelivery(db, {
      ...input,
      from: input.delivery === "steer" ? "queue" : "steer",
      to: input.delivery,
    }),
)

export const list = Effect.fn("SessionInbox.list")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  const rows = yield* db
    .select()
    .from(SessionInboxTable)
    .where(eq(SessionInboxTable.session_id, sessionID))
    .orderBy(asc(SessionInboxTable.enqueued_seq))
    .all()
    .pipe(Effect.orDie)
  return rows.map(fromRow)
})

export const moveIDs = Effect.fn("SessionInbox.moveIDs")(function* (db: DatabaseService, sessionID: SessionSchema.ID) {
  return yield* db
    .select({ id: SessionInboxTable.id })
    .from(SessionInboxTable)
    .where(and(eq(SessionInboxTable.session_id, sessionID), eq(SessionInboxTable.type, "move")))
    .orderBy(asc(SessionInboxTable.enqueued_seq))
    .all()
    .pipe(Effect.orDie)
})

export const nextPromotable = Effect.fn("SessionInbox.nextPromotable")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  promotable: Promotable,
) {
  const steer = (yield* pendingSteers(db, sessionID))[0]
  if (steer) return fromRow(steer)
  if (promotable !== "input") return undefined
  const queued = yield* db
    .select()
    .from(SessionInboxTable)
    .where(and(eq(SessionInboxTable.session_id, sessionID), eq(SessionInboxTable.delivery, "queue")))
    .orderBy(asc(SessionInboxTable.enqueued_seq))
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return queued ? fromRow(queued) : undefined
})

/** Which pending rows count: "input" means any item in either delivery mode. */
export type Scope = "input" | Delivery

export const has = Effect.fn("SessionInbox.has")(function* (
  db: DatabaseService,
  sessionID: SessionSchema.ID,
  scope: Scope,
) {
  const row = yield* db
    .select({ id: SessionInboxTable.id })
    .from(SessionInboxTable)
    .where(
      and(
        eq(SessionInboxTable.session_id, sessionID),
        scope === "input"
          ? or(eq(SessionInboxTable.delivery, "steer"), eq(SessionInboxTable.delivery, "queue"))
          : eq(SessionInboxTable.delivery, scope),
      ),
    )
    .limit(1)
    .get()
    .pipe(Effect.orDie)
  return row !== undefined
})

const publishMutation = <A, E, R>(input: PendingRef, effect: Effect.Effect<A, E, R>) =>
  serialized(input.sessionID, effect).pipe(
    Effect.asVoid,
    // Bus projectors abort their transaction through the defect channel.
    Effect.catchDefect((defect) => (defect instanceof LifecycleConflict ? Effect.fail(defect) : Effect.die(defect))),
  )

const publish = Effect.fn("SessionInbox.publish")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  rows: ReadonlyArray<typeof SessionInboxTable.$inferSelect>,
) {
  yield* Effect.forEach(
    rows,
    (row) => {
      const entry = fromRow(row)
      if (entry.type === "compaction") return Effect.die(new LifecycleConflict({ id: entry.id }))
      return bus
        .publish(SessionEvent.InboxDelivered, {
          sessionID,
          inboxID: entry.id,
        })
        .pipe(
          Effect.catchDefect((defect) =>
            defect instanceof LifecycleConflict
              ? promotedFromMessage(db, sessionID, entry.id, entry.delivery).pipe(
                  Effect.flatMap((stored) => (stored !== undefined ? Effect.void : Effect.die(defect))),
                  Effect.orDie,
                )
              : Effect.die(defect),
          ),
        )
    },
    { discard: true },
  )
  return rows.length
})

/**
 * Promotes pending input into visible messages and returns the promoted count,
 * or undefined when the runner must first handle a pending control.
 * Steered compaction takes priority over pending prompts, without crossing a move.
 * Only the "input" scope may fall through to one queued input.
 */
export const promote = Effect.fn("SessionInbox.promote")(function* (
  db: DatabaseService,
  bus: Bus.Interface,
  sessionID: SessionSchema.ID,
  scope: Promotable,
) {
  return yield* serialized(
    sessionID,
    Effect.gen(function* () {
      const steers = yield* pendingSteers(db, sessionID)
      if (steers.length > 0 || scope === "steer") {
        const control = steers.findIndex((row) => row.type === "compaction" || row.type === "move")
        if (control === 0) return undefined
        return yield* publish(db, bus, sessionID, control === -1 ? steers : steers.slice(0, control))
      }

      const queued = yield* db
        .select()
        .from(SessionInboxTable)
        .where(and(eq(SessionInboxTable.session_id, sessionID), eq(SessionInboxTable.delivery, "queue")))
        .orderBy(asc(SessionInboxTable.enqueued_seq))
        .limit(1)
        .get()
        .pipe(Effect.orDie)
      if (!queued) return 0
      if (queued.type === "compaction" || queued.type === "move") return undefined
      const promoted = yield* publish(db, bus, sessionID, [queued])
      const arrivedSteers = yield* pendingSteers(db, sessionID)
      const control = arrivedSteers.findIndex((row) => row.type === "compaction" || row.type === "move")
      return (
        promoted +
        (yield* publish(db, bus, sessionID, control === -1 ? arrivedSteers : arrivedSteers.slice(0, control)))
      )
    }),
  )
})

const pendingSteers = (db: DatabaseService, sessionID: SessionSchema.ID) =>
  db
    .select()
    .from(SessionInboxTable)
    .where(and(eq(SessionInboxTable.session_id, sessionID), eq(SessionInboxTable.delivery, "steer")))
    .orderBy(asc(SessionInboxTable.enqueued_seq))
    .all()
    .pipe(
      Effect.orDie,
      Effect.map((rows) => {
        // A move changes the context's Location: never pull compaction across it.
        // Within that boundary, compact before promoting even earlier steers so
        // their text stays verbatim after the checkpoint, not inside its summary.
        const control = rows.findIndex((row) => row.type === "compaction" || row.type === "move")
        if (control > 0 && rows[control].type === "compaction") rows.unshift(...rows.splice(control, 1))
        return rows
      }),
    )
