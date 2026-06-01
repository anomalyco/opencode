export * as SessionMailbox from "./mailbox"

import { and, asc, eq, inArray } from "drizzle-orm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { EventV2 } from "../event"
import { withStatics } from "../schema"
import { Identifier } from "../util/identifier"
import { SessionEvent } from "./event"
import { SessionMailboxTable } from "./sql"
import { SessionSchema } from "./schema"

export const ID = Schema.String.check(Schema.isStartsWith("mail_")).pipe(
  Schema.brand("SessionMailbox.ID"),
  withStatics((schema) => ({ create: () => schema.make("mail_" + Identifier.ascending()) })),
)
export type ID = typeof ID.Type

export const Kind = SessionEvent.MailboxKind
export type Kind = typeof Kind.Type

export const Delivery = SessionEvent.MailboxDelivery
export type Delivery = typeof Delivery.Type

export const State = SessionEvent.MailboxState
export type State = typeof State.Type

export interface Message {
  readonly id: ID
  readonly fromSessionID?: SessionSchema.ID
  readonly toSessionID: SessionSchema.ID
  readonly rootSessionID?: SessionSchema.ID
  readonly kind: Kind
  readonly delivery: Delivery
  readonly state: State
  readonly text: string
  readonly metadata?: Record<string, unknown>
  readonly claimID?: string
  readonly error?: string
  readonly time: {
    readonly created: number
    readonly updated: number
    readonly processing?: number
    readonly completed?: number
  }
}

export interface EnqueueInput {
  readonly id?: ID
  readonly fromSessionID?: SessionSchema.ID
  readonly toSessionID: SessionSchema.ID
  readonly rootSessionID?: SessionSchema.ID
  readonly kind: Kind
  readonly delivery: Delivery
  readonly text: string
  readonly metadata?: Record<string, unknown>
}

export interface ClaimInput {
  readonly toSessionID: SessionSchema.ID
  readonly kind?: Kind
  readonly delivery?: Delivery
  readonly limit?: number
  readonly claimID?: string
}

export interface ListInput {
  readonly toSessionID?: SessionSchema.ID
  readonly kind?: Kind
  readonly delivery?: Delivery
  readonly state?: State
  readonly limit?: number
}

export interface CancelInput {
  readonly id: ID
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("SessionMailbox.NotFoundError", {
  id: ID,
}) {}

export interface Interface {
  readonly enqueue: (input: EnqueueInput) => Effect.Effect<Message>
  readonly claim: (input: ClaimInput) => Effect.Effect<Message[]>
  readonly delivered: (id: ID) => Effect.Effect<Message, NotFoundError>
  readonly failed: (input: { readonly id: ID; readonly error?: string }) => Effect.Effect<Message, NotFoundError>
  readonly cancel: (input: CancelInput | ID) => Effect.Effect<Message, NotFoundError>
  readonly get: (id: ID) => Effect.Effect<Message, NotFoundError>
  readonly list: (input?: ListInput) => Effect.Effect<Message[]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionMailbox") {}

type Row = typeof SessionMailboxTable.$inferSelect

function fromRow(row: Row): Message {
  return {
    id: ID.make(row.id),
    fromSessionID: row.from_session_id ?? undefined,
    toSessionID: row.to_session_id,
    rootSessionID: row.root_session_id ?? undefined,
    kind: row.kind,
    delivery: row.delivery,
    state: row.state,
    text: row.text,
    metadata: row.metadata ?? undefined,
    claimID: row.claim_id ?? undefined,
    error: row.error ?? undefined,
    time: {
      created: row.time_created,
      updated: row.time_updated,
      processing: row.time_processing ?? undefined,
      completed: row.time_completed ?? undefined,
    },
  }
}

function eventData(message: Message) {
  return {
    timestamp: DateTime.makeUnsafe(message.time.updated),
    sessionID: message.toSessionID,
    messageID: message.id,
    kind: message.kind,
    delivery: message.delivery,
    ...(message.fromSessionID ? { fromSessionID: message.fromSessionID } : {}),
    ...(message.rootSessionID ? { rootSessionID: message.rootSessionID } : {}),
  }
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service

    const publish = (message: Message) => {
      const data = eventData(message)
      const effect = (() => {
        switch (message.state) {
          case "queued":
            return events.publish(SessionEvent.Mailbox.Enqueued, data)
          case "processing":
            return events.publish(SessionEvent.Mailbox.Processing, { ...data, claimID: message.claimID })
          case "delivered":
            return events.publish(SessionEvent.Mailbox.Delivered, data)
          case "failed":
            return events.publish(SessionEvent.Mailbox.Failed, { ...data, error: message.error })
          case "cancelled":
            return events.publish(SessionEvent.Mailbox.Cancelled, data)
        }
      })()
      return effect.pipe(Effect.catchCause(() => Effect.void), Effect.asVoid)
    }

    const getRow = (id: ID) => db.select().from(SessionMailboxTable).where(eq(SessionMailboxTable.id, id)).get()

    const requireRow = (id: ID) =>
      Effect.gen(function* () {
        const row = yield* getRow(id).pipe(Effect.orDie)
        if (!row) return yield* new NotFoundError({ id })
        return row
      })

    const updateTerminal = (id: ID, state: "delivered" | "failed", error?: string) =>
      db
        .transaction(
          () =>
            Effect.gen(function* () {
              const current = yield* requireRow(id)
              if (current.state !== "processing") return { row: current, changed: false }
              const now = Date.now()
              yield* db
                .update(SessionMailboxTable)
                .set({ state, error, time_completed: now, time_updated: now })
                .where(eq(SessionMailboxTable.id, id))
                .run()
              const next = yield* requireRow(id)
              return { row: next, changed: true }
            }),
          { behavior: "immediate" },
        )
        .pipe(Effect.orDie)

    return Service.of({
      enqueue: Effect.fn("SessionMailbox.enqueue")(function* (input) {
        const now = Date.now()
        const id = input.id ?? ID.create()
        const row = {
          id,
          from_session_id: input.fromSessionID,
          to_session_id: input.toSessionID,
          root_session_id: input.rootSessionID,
          kind: input.kind,
          delivery: input.delivery,
          state: "queued" as const,
          text: input.text,
          metadata: input.metadata,
          time_created: now,
          time_updated: now,
        }
        yield* db.insert(SessionMailboxTable).values([row]).run().pipe(Effect.orDie)
        const message = fromRow({ ...row, claim_id: null, error: null, time_processing: null, time_completed: null })
        yield* publish(message)
        return message
      }),

      claim: Effect.fn("SessionMailbox.claim")(function* (input) {
        const limit = Math.max(1, Math.floor(input.limit ?? 1))
        const claimID = input.claimID ?? `claim_${Identifier.ascending()}`
        const rows = yield* db
          .transaction(
            () =>
              Effect.gen(function* () {
                const existing = yield* db
                  .select()
                  .from(SessionMailboxTable)
                  .where(
                    and(
                      eq(SessionMailboxTable.claim_id, claimID),
                      eq(SessionMailboxTable.to_session_id, input.toSessionID),
                      eq(SessionMailboxTable.state, "processing"),
                      input.kind ? eq(SessionMailboxTable.kind, input.kind) : undefined,
                      input.delivery ? eq(SessionMailboxTable.delivery, input.delivery) : undefined,
                    ),
                  )
                  .orderBy(asc(SessionMailboxTable.time_created), asc(SessionMailboxTable.id))
                  .limit(limit)
                  .all()
                if (existing.length > 0) return { rows: existing, changed: [] as Row[] }

                const candidates = yield* db
                  .select({ id: SessionMailboxTable.id })
                  .from(SessionMailboxTable)
                  .where(
                    and(
                      eq(SessionMailboxTable.to_session_id, input.toSessionID),
                      eq(SessionMailboxTable.state, "queued"),
                      input.kind ? eq(SessionMailboxTable.kind, input.kind) : undefined,
                      input.delivery ? eq(SessionMailboxTable.delivery, input.delivery) : undefined,
                    ),
                  )
                  .orderBy(asc(SessionMailboxTable.time_created), asc(SessionMailboxTable.id))
                  .limit(limit)
                  .all()
                const ids = candidates.map((candidate) => candidate.id)
                if (ids.length === 0) return { rows: [] as Row[], changed: [] as Row[] }
                const now = Date.now()
                yield* db
                  .update(SessionMailboxTable)
                  .set({ state: "processing", claim_id: claimID, time_processing: now, time_updated: now })
                  .where(and(inArray(SessionMailboxTable.id, ids), eq(SessionMailboxTable.state, "queued")))
                  .run()
                const claimed = yield* db
                  .select()
                  .from(SessionMailboxTable)
                  .where(inArray(SessionMailboxTable.id, ids))
                  .orderBy(asc(SessionMailboxTable.time_created), asc(SessionMailboxTable.id))
                  .all()
                return { rows: claimed.filter((row) => row.claim_id === claimID), changed: claimed }
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie)
        const messages = rows.rows.map(fromRow)
        for (const row of rows.changed) {
          if (row.state === "processing" && row.claim_id === claimID) yield* publish(fromRow(row))
        }
        return messages
      }),

      delivered: Effect.fn("SessionMailbox.delivered")(function* (id) {
        const result = yield* updateTerminal(id, "delivered")
        const message = fromRow(result.row)
        if (result.changed) yield* publish(message)
        return message
      }),

      failed: Effect.fn("SessionMailbox.failed")(function* (input) {
        const result = yield* updateTerminal(input.id, "failed", input.error)
        const message = fromRow(result.row)
        if (result.changed) yield* publish(message)
        return message
      }),

      cancel: Effect.fn("SessionMailbox.cancel")(function* (input) {
        const id = typeof input === "string" ? input : input.id
        const result = yield* db
          .transaction(
            () =>
              Effect.gen(function* () {
                const current = yield* requireRow(id)
                if (current.state !== "queued" && current.state !== "processing") return { row: current, changed: false }
                const now = Date.now()
                yield* db
                  .update(SessionMailboxTable)
                  .set({ state: "cancelled", time_completed: now, time_updated: now })
                  .where(eq(SessionMailboxTable.id, id))
                  .run()
                const next = yield* requireRow(id)
                return { row: next, changed: true }
              }),
            { behavior: "immediate" },
          )
          .pipe(Effect.orDie)
        const message = fromRow(result.row)
        if (result.changed) yield* publish(message)
        return message
      }),

      get: Effect.fn("SessionMailbox.get")(function* (id) {
        return fromRow(yield* requireRow(id))
      }),

      list: Effect.fn("SessionMailbox.list")(function* (input = {}) {
        const rows = yield* db
          .select()
          .from(SessionMailboxTable)
          .where(
            and(
              input.toSessionID ? eq(SessionMailboxTable.to_session_id, input.toSessionID) : undefined,
              input.kind ? eq(SessionMailboxTable.kind, input.kind) : undefined,
              input.delivery ? eq(SessionMailboxTable.delivery, input.delivery) : undefined,
              input.state ? eq(SessionMailboxTable.state, input.state) : undefined,
            ),
          )
          .orderBy(asc(SessionMailboxTable.to_session_id), asc(SessionMailboxTable.kind), asc(SessionMailboxTable.time_created), asc(SessionMailboxTable.id))
          .limit(input.limit ?? 100)
          .all()
          .pipe(Effect.orDie)
        return rows.map(fromRow)
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
