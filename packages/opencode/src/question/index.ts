import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect"
import { SessionID, MessageID } from "@/session/schema"
import { zod } from "@/util/effect-zod"
import { Log } from "@/util"
import { withStatics } from "@/util/schema"
import { QuestionID } from "./schema"

const log = Log.create({ service: "question" })

// Schemas

export class Option extends Schema.Class<Option>("QuestionOption")({
  label: Schema.String.annotate({
    description: "Display text (1-5 words, concise)",
  }),
  description: Schema.String.annotate({
    description: "Explanation of choice",
  }),
}) {
  static readonly zod = zod(this)
}

const base = {
  question: Schema.String.annotate({
    description: "Complete question",
  }),
  header: Schema.String.annotate({
    description: "Very short label (max 30 chars)",
  }),
  options: Schema.Array(Option).annotate({
    description: "Available choices",
  }),
  multiple: Schema.optional(Schema.Boolean).annotate({
    description: "Allow selecting multiple choices",
  }),
}

export class Info extends Schema.Class<Info>("QuestionInfo")({
  ...base,
  custom: Schema.optional(Schema.Boolean).annotate({
    description: "Allow typing a custom answer (default: true)",
  }),
}) {
  static readonly zod = zod(this)
}

export class Prompt extends Schema.Class<Prompt>("QuestionPrompt")(base) {
  static readonly zod = zod(this)
}

export class Tool extends Schema.Class<Tool>("QuestionTool")({
  messageID: MessageID,
  callID: Schema.String,
}) {
  static readonly zod = zod(this)
}

export class Request extends Schema.Class<Request>("QuestionRequest")({
  id: QuestionID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({
    description: "Questions to ask",
  }),
  tool: Schema.optional(Tool),
}) {
  static readonly zod = zod(this)
}

export const Answer = Schema.Array(Schema.String)
  .annotate({ identifier: "QuestionAnswer" })
  .pipe(withStatics((s) => ({ zod: zod(s) })))
export type Answer = Schema.Schema.Type<typeof Answer>

export class Reply extends Schema.Class<Reply>("QuestionReply")({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}) {
  static readonly zod = zod(this)
}

class Replied extends Schema.Class<Replied>("QuestionReplied")({
  sessionID: SessionID,
  requestID: QuestionID,
  answers: Schema.Array(Answer),
}) {}

class Rejected extends Schema.Class<Rejected>("QuestionRejected")({
  sessionID: SessionID,
  requestID: QuestionID,
}) {}

export const Event = {
  Asked: BusEvent.define("question.asked", Request.zod),
  Replied: BusEvent.define("question.replied", zod(Replied)),
  Rejected: BusEvent.define("question.rejected", zod(Rejected)),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<ReadonlyArray<Answer>, RejectedError>
}

interface State {
  pending: Map<QuestionID, PendingEntry>
}

// Service

export interface Interface {
  readonly ask: (input: {
    sessionID: SessionID
    questions: ReadonlyArray<Info>
    tool?: Tool
  }) => Effect.Effect<ReadonlyArray<Answer>, RejectedError>
  readonly reply: (input: { requestID: QuestionID; answers: ReadonlyArray<Answer> }) => Effect.Effect<void>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Question") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Question.state")(function* () {
        const state = {
          pending: new Map<QuestionID, PendingEntry>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const id = QuestionID.ascending()
      log.info("asking", { id, questions: input.questions.length })

      const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
      const info = Schema.decodeUnknownSync(Request)({
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      })
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Asked, info)

      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Question.reply")(function* (input: {
      requestID: QuestionID
      answers: ReadonlyArray<Answer>
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(input.requestID)
      if (!existing) {
        log.warn("reply for unknown request", { requestID: input.requestID })
        return
      }
      pending.delete(input.requestID)
      log.info("replied", { requestID: input.requestID, answers: input.answers })
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        answers: input.answers,
      })
      yield* Deferred.succeed(existing.deferred, input.answers)
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        log.warn("reject for unknown request", { requestID })
        return
      }
      pending.delete(requestID)
      log.info("rejected", { requestID })
      yield* bus.publish(Event.Rejected, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Question from "."
