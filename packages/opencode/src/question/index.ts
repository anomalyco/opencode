import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { SessionID } from "@/session/schema"
import { QuestionID } from "./schema"
import { EventV2Bridge } from "@/event-v2-bridge"
import { QuestionV1 } from "@opencode-ai/schema/question-v1"
import { SessionClosure } from "@/session/closure/coordinator"
import { SessionAdmission } from "@/session/closure/admission"

export const Option = QuestionV1.Option
export type Option = typeof Option.Type
export const Info = QuestionV1.Info
export type Info = typeof Info.Type
export const Prompt = QuestionV1.Prompt
export type Prompt = typeof Prompt.Type
export const Tool = QuestionV1.Tool
export type Tool = typeof Tool.Type
export const Request = QuestionV1.Request
export type Request = typeof Request.Type
export const Answer = QuestionV1.Answer
export type Answer = typeof Answer.Type
export const Reply = QuestionV1.Reply
export type Reply = typeof Reply.Type
export const Replied = QuestionV1.Replied
export const Rejected = QuestionV1.Rejected
export const Event = QuestionV1.Event

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
  override get message() {
    return "The user dismissed this question"
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Question.NotFoundError", {
  requestID: QuestionID,
}) {}

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
  readonly reply: (input: {
    requestID: QuestionID
    answers: ReadonlyArray<Answer>
  }) => Effect.Effect<void, NotFoundError | SessionClosure.AdmissionRefused>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError | SessionClosure.AdmissionRefused>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Question") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const closure = yield* SessionClosure.Service
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
      yield* Effect.logInfo("asking", { id, questions: input.questions.length })

      const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      pending.set(id, { info, deferred })
      yield* events.publish(Event.Asked, info)

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
        yield* Effect.logWarning("reply for unknown request", { requestID: input.requestID })
        return yield* new NotFoundError({ requestID: input.requestID })
      }
      // An answer resumes the suspended tool that asked, so the guard has to run before the
      // deferred resolves: after a branch closes, resuming its tool restarts the work that was
      // just stopped. There is no cascade here — exactly one deferred is resolved — so one
      // admission covers the whole resolved set by construction.
      //
      // `retryable: false` is what keeps that decided. Waiting for release and then running this
      // body is precisely resuming the suspended tool after the branch closed. The joined
      // admission is still settled.
      return yield* SessionAdmission.admitted(
        closure,
        { session: existing.info.sessionID, origin: "external", source: "Question.reply", retryable: false },
        () =>
          Effect.gen(function* () {
            pending.delete(input.requestID)
            yield* Effect.logInfo("replied", { requestID: input.requestID, answers: input.answers })
            yield* events.publish(Event.Replied, {
              sessionID: existing.info.sessionID,
              requestID: existing.info.id,
              answers: input.answers.map((a) => [...a]),
            })
            yield* Deferred.succeed(existing.deferred, input.answers)
          }),
      )
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        yield* Effect.logWarning("reject for unknown request", { requestID })
        return yield* new NotFoundError({ requestID })
      }
      // Admitted for the same reason the answer is, and the reason is evidence rather than
      // symmetry: a rejection reaches the processor's tool-call failure path, which writes the
      // part to error — a durable transcript mutation — and only then breaks conditionally. So
      // this is a continuation, not a proven termination, and retrying it after release would
      // drive that mutation into a branch that has just closed.
      return yield* SessionAdmission.admitted(
        closure,
        { session: existing.info.sessionID, origin: "external", source: "Question.reject", retryable: false },
        () =>
          Effect.gen(function* () {
            pending.delete(requestID)
            yield* Effect.logInfo("rejected", { requestID })
            yield* events.publish(Event.Rejected, {
              sessionID: existing.info.sessionID,
              requestID: existing.info.id,
            })
            yield* Deferred.fail(existing.deferred, new RejectedError())
          }),
      )
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (x) => x.info)
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [EventV2Bridge.node, SessionClosure.node],
})

export * as Question from "."
