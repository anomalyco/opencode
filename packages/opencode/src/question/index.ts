import { Deferred, Effect, Layer, Schema, Context } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { makeRuntime } from "@/effect/run-service"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import z from "zod"
import { QuestionID } from "./schema"

export namespace Question {
  const log = Log.create({ service: "question" })

  // Schemas

  export const Option = z
    .object({
      label: z.string().describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({ ref: "QuestionOption" })
  export type Option = z.infer<typeof Option>

  export const Info = z
    .object({
      question: z.string().describe("Complete question"),
      header: z.string().describe("Very short label (max 30 chars)"),
      options: z.array(Option).describe("Available choices"),
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
      custom: z.boolean().optional().describe("Allow typing a custom answer (default: true)"),
    })
    .meta({ ref: "QuestionInfo" })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: QuestionID.zod,
      sessionID: SessionID.zod,
      questions: z.array(Info).describe("Questions to ask"),
      tool: z
        .object({
          messageID: MessageID.zod,
          callID: z.string(),
        })
        .optional(),
    })
    .meta({ ref: "QuestionRequest" })
  export type Request = z.infer<typeof Request>

  export const Answer = z.array(z.string()).meta({ ref: "QuestionAnswer" })
  export type Answer = z.infer<typeof Answer>

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("question.asked", Request),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
        answers: z.array(Answer),
      }),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        sessionID: SessionID.zod,
        requestID: QuestionID.zod,
      }),
    ),
  }

  export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("QuestionRejectedError", {}) {
    override get message() {
      return "The user dismissed this question"
    }
  }

  interface PendingEntry {
    info: Request
    deferred: Deferred.Deferred<Answer[], RejectedError>
  }

  interface State {
    pending: Map<QuestionID, PendingEntry>
  }

  // Service

  export interface Interface {
    readonly ask: (input: {
      sessionID: SessionID
      questions: Info[]
      tool?: { messageID: MessageID; callID: string }
    }) => Effect.Effect<Answer[], RejectedError>
    readonly reply: (input: { requestID: QuestionID; answers: Answer[] }) => Effect.Effect<void>
    readonly reject: (requestID: QuestionID) => Effect.Effect<void>
    readonly list: () => Effect.Effect<Request[]>
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
        questions: Info[]
        tool?: { messageID: MessageID; callID: string }
      }) {
        const pending = (yield* InstanceState.get(state)).pending
        const id = QuestionID.ascending()
        log.info("asking", { id, questions: input.questions.length })

        const deferred = yield* Deferred.make<Answer[], RejectedError>()
        const info: Request = {
          id,
          sessionID: input.sessionID,
          questions: input.questions,
          tool: input.tool,
        }
        pending.set(id, { info, deferred })
        yield* bus.publish(Event.Asked, info)

        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            pending.delete(id)
          }),
        )
      })

      const reply = Effect.fn("Question.reply")(function* (input: { requestID: QuestionID; answers: Answer[] }) {
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

  const { runPromise } = makeRuntime(Service, defaultLayer)

  export async function ask(input: {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
  }): Promise<Answer[]> {
    return runPromise((s) => s.ask(input))
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }) {
    return runPromise((s) => s.reply(input))
  }

  export async function reject(requestID: QuestionID) {
    return runPromise((s) => s.reject(requestID))
  }

  export async function list() {
    return runPromise((s) => s.list())
  }
}
