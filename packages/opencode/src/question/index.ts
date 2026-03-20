import { Deferred, Effect, Layer, Schema, ServiceMap } from "effect"
import { runPromiseInstance } from "@/effect/runtime"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { SessionID, MessageID } from "@/session/schema"
import { Log } from "@/util/log"
import z from "zod"
import { QuestionID } from "./schema"

const log = Log.create({ service: "question" })

export namespace Question {
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

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Question") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const pending = new Map<QuestionID, PendingEntry>()

      const ask = Effect.fn("Question.ask")(function* (input: {
        sessionID: SessionID
        questions: Info[]
        tool?: { messageID: MessageID; callID: string }
      }) {
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
        Bus.publish(Event.Asked, info)

        return yield* Effect.ensuring(
          Deferred.await(deferred),
          Effect.sync(() => {
            pending.delete(id)
          }),
        )
      })

      const reply = Effect.fn("Question.reply")(function* (input: { requestID: QuestionID; answers: Answer[] }) {
        const existing = pending.get(input.requestID)
        if (!existing) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return
        }
        pending.delete(input.requestID)
        log.info("replied", { requestID: input.requestID, answers: input.answers })
        Bus.publish(Event.Replied, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
          answers: input.answers,
        })
        yield* Deferred.succeed(existing.deferred, input.answers)
      })

      const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
        const existing = pending.get(requestID)
        if (!existing) {
          log.warn("reject for unknown request", { requestID })
          return
        }
        pending.delete(requestID)
        log.info("rejected", { requestID })
        Bus.publish(Event.Rejected, {
          sessionID: existing.info.sessionID,
          requestID: existing.info.id,
        })
        yield* Deferred.fail(existing.deferred, new RejectedError())
      })

      const list = Effect.fn("Question.list")(function* () {
        return Array.from(pending.values(), (x) => x.info)
      })

      return Service.of({ ask, reply, reject, list })
    }),
  )

  export async function ask(input: {
    sessionID: SessionID
    questions: Info[]
    tool?: { messageID: MessageID; callID: string }
  }): Promise<Answer[]> {
    return runPromiseInstance(Service.use((svc) => svc.ask(input)))
  }

  export async function reply(input: { requestID: QuestionID; answers: Answer[] }): Promise<void> {
    return runPromiseInstance(Service.use((svc) => svc.reply(input)))
  }

  export async function reject(requestID: QuestionID): Promise<void> {
    return runPromiseInstance(Service.use((svc) => svc.reject(requestID)))
  }

  export async function list(): Promise<Request[]> {
    return runPromiseInstance(Service.use((svc) => svc.list()))
  }
}
