export * as QuestionV2 from "./question"

import { makeLocationNode } from "./effect/app-node"
import { Context, DateTime, Deferred, Effect, Layer, Schema } from "effect"
import { and, asc, eq, isNull } from "drizzle-orm"
import { Question } from "@opencode-ai/schema/question"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { Location } from "./location"
import { QuestionOutput } from "./question-output"
import { QuestionPendingTable } from "./question.sql"
import { SessionEvent } from "./session/event"
import { SessionMessage } from "./session/message"
import { SessionSchema } from "./session/schema"
import { SessionTable } from "./session/sql"

export const ID = Question.ID
export type ID = typeof ID.Type

export const Option = Question.Option
export type Option = typeof Option.Type

export const Info = Question.Info
export type Info = typeof Info.Type

export const Prompt = Question.Prompt
export type Prompt = typeof Prompt.Type

export const Tool = Question.Tool
export type Tool = typeof Tool.Type

export const Request = Question.Request
export type Request = typeof Request.Type

export const Answer = Question.Answer
export type Answer = typeof Answer.Type

export const Reply = Question.Reply
export type Reply = typeof Reply.Type

export const Event = Question.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionV2.RejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("QuestionV2.NotFoundError", {
  requestID: ID,
}) {}

export interface AskInput {
  readonly sessionID: SessionSchema.ID
  readonly questions: ReadonlyArray<Info>
  readonly tool?: Tool
}

export interface ReplyInput {
  readonly requestID: ID
  readonly answers: ReadonlyArray<Answer>
}

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: ID) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/Question") {}

interface Pending {
  readonly request: Request
  readonly deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

/**
 * Location-owned pending prompts. The Location layer map must materialize this
 * layer once per embedded Location so replies cannot settle another Location's
 * deferred request.
 */
const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    const location = yield* Location.Service
    const pending = new Map<ID, Pending>()
    const decodeRequest = Schema.decodeUnknownSync(Request)
    const answers = (input: ReplyInput) => input.answers.map((answer) => [...answer])
    const locationFilter = and(
      eq(SessionTable.directory, location.directory),
      location.workspaceID === undefined
        ? isNull(SessionTable.workspace_id)
        : eq(SessionTable.workspace_id, location.workspaceID),
    )
    const pendingRequest = Effect.fn("QuestionV2.pendingRequest")(function* (requestID: ID) {
      const row = yield* db
        .select({ request: QuestionPendingTable.request })
        .from(QuestionPendingTable)
        .innerJoin(SessionTable, eq(QuestionPendingTable.session_id, SessionTable.id))
        .where(and(eq(QuestionPendingTable.id, requestID), locationFilter))
        .get()
        .pipe(Effect.orDie)
      return row ? decodeRequest(row.request) : undefined
    })
    const deletePending = (requestID: ID) =>
      db
        .delete(QuestionPendingTable)
        .where(eq(QuestionPendingTable.id, requestID))
        .run()
        .pipe(Effect.orDie, Effect.asVoid)
    const publishReplied = (request: Request, input: ReplyInput) =>
      events.publish(Event.Replied, {
        sessionID: request.sessionID,
        requestID: request.id,
        answers: answers(input),
      })

    yield* Effect.addFinalizer(() =>
      Effect.forEach(pending.values(), (item) => Deferred.fail(item.deferred, new RejectedError()), {
        discard: true,
      }).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            pending.clear()
          }),
        ),
      ),
    )

    const ask = Effect.fn("QuestionV2.ask")((input: AskInput) =>
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const id = ID.ascending()
          const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
          const request: Request = { id, ...input }
          pending.set(id, { request, deferred })
          return yield* events
            .publish(Event.Asked, request, {
              commit: (seq) =>
                Effect.gen(function* () {
                  const session = yield* db
                    .select({ id: SessionTable.id })
                    .from(SessionTable)
                    .where(eq(SessionTable.id, request.sessionID))
                    .get()
                    .pipe(Effect.orDie)
                  if (!session) return
                  yield* db
                    .insert(QuestionPendingTable)
                    .values({
                      id,
                      session_id: request.sessionID,
                      request,
                      asked_seq: seq,
                    })
                    .run()
                    .pipe(Effect.orDie)
                }),
            })
            .pipe(
              Effect.andThen(restore(Deferred.await(deferred))),
              Effect.ensuring(
                Effect.sync(() => {
                  pending.delete(id)
                }),
              ),
            )
        }),
      ),
    )

    const reply = Effect.fn("QuestionV2.reply")((input: ReplyInput) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(input.requestID)
          if (existing) {
            yield* publishReplied(existing.request, input)
            yield* Deferred.succeed(existing.deferred, input.answers)
            pending.delete(input.requestID)
            yield* deletePending(input.requestID)
            return
          }

          const request = yield* pendingRequest(input.requestID)
          if (!request) return yield* new NotFoundError({ requestID: input.requestID })
          if (request.tool) {
            const settled = answers(input)
            yield* events.publish(
              SessionEvent.Tool.Success,
              {
                sessionID: request.sessionID,
                timestamp: yield* DateTime.now,
                assistantMessageID: SessionMessage.ID.make(request.tool.messageID),
                callID: request.tool.callID,
                structured: { answers: settled },
                content: [{ type: "text", text: QuestionOutput.toModelOutput(request.questions, settled) }],
                recovery: { type: "question", requestID: request.id },
                provider: { executed: false },
              },
              { commit: () => deletePending(input.requestID) },
            )
          } else {
            yield* deletePending(input.requestID)
          }
          yield* publishReplied(request, input)
        }),
      ),
    )

    const reject = Effect.fn("QuestionV2.reject")((requestID: ID) =>
      Effect.uninterruptible(
        Effect.gen(function* () {
          const existing = pending.get(requestID)
          if (!existing) return yield* new NotFoundError({ requestID })
          yield* events.publish(Event.Rejected, {
            sessionID: existing.request.sessionID,
            requestID: existing.request.id,
          })
          yield* Deferred.fail(existing.deferred, new RejectedError())
          pending.delete(requestID)
          yield* db.delete(QuestionPendingTable).where(eq(QuestionPendingTable.id, requestID)).run().pipe(Effect.orDie)
        }),
      ),
    )

    const list = Effect.fn("QuestionV2.list")(function* () {
      const rows = yield* db
        .select({ request: QuestionPendingTable.request })
        .from(QuestionPendingTable)
        .innerJoin(SessionTable, eq(QuestionPendingTable.session_id, SessionTable.id))
        .where(locationFilter)
        .orderBy(asc(QuestionPendingTable.asked_seq))
        .all()
        .pipe(Effect.orDie)

      const durable = rows.map((row) => decodeRequest(row.request))
      const durableIDs = new Set(durable.map((request) => request.id))
      return durable.concat(
        Array.from(pending.values(), (item) => item.request).filter((request) => !durableIDs.has(request.id)),
      )
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const locationLayer = layer

export const node = makeLocationNode({
  service: Service,
  layer,
  deps: [Database.node, EventV2.node, Location.node],
})
