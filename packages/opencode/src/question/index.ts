import { Deferred, Effect, Layer, Schema, Context, Option as EffectOption } from "effect"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { InstanceState } from "@/effect/instance-state"
import { SessionID, MessageID, PartID } from "@/session/schema"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { QuestionID } from "./schema"

const log = Log.create({ service: "question" })

// Schemas — these are pure data; nothing checks class identity (see PR
// description) so they're plain `Schema.Struct` + type alias. That lets
// `Question.ask` and other internal sites trust the type contract without a
// re-decode to coerce nested class instances.

export const Option = Schema.Struct({
  label: Schema.String.annotate({
    description: "Display text (1-5 words, concise)",
  }),
  description: Schema.String.annotate({
    description: "Explanation of choice",
  }),
}).annotate({ identifier: "QuestionOption" })
export type Option = Schema.Schema.Type<typeof Option>

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

export const Prompt = Schema.Struct(base).annotate({ identifier: "QuestionPrompt" })
export type Prompt = Schema.Schema.Type<typeof Prompt>

export const Info = Prompt
export type Info = Prompt

export const Image = Schema.Struct({
  type: Schema.Literal("image"),
  mime: Schema.String,
  url: Schema.String,
  filename: Schema.optional(Schema.String),
}).annotate({ identifier: "QuestionImageAnswer" })
export type Image = Schema.Schema.Type<typeof Image>

export const Part = Schema.Union([Schema.String, Image]).annotate({ identifier: "QuestionAnswerPart" })
export type Part = Schema.Schema.Type<typeof Part>

export const Tool = Schema.Struct({
  messageID: MessageID,
  callID: Schema.String,
}).annotate({ identifier: "QuestionTool" })
export type Tool = Schema.Schema.Type<typeof Tool>

export const Request = Schema.Struct({
  id: QuestionID,
  sessionID: SessionID,
  questions: Schema.Array(Info).annotate({
    description: "Questions to ask",
  }),
  tool: Schema.optional(Tool),
}).annotate({ identifier: "QuestionRequest" })
export type Request = Schema.Schema.Type<typeof Request>
const isRequest = Schema.is(Request)

export const Answer = Schema.Array(Part).annotate({ identifier: "QuestionAnswer" })
export type Answer = Schema.Schema.Type<typeof Answer>

export const Reply = Schema.Struct({
  answers: Schema.Array(Answer).annotate({
    description: "User answers in order of questions (each answer is an array of selected labels)",
  }),
}).annotate({ identifier: "QuestionReply" })
export type Reply = Schema.Schema.Type<typeof Reply>

const Replied = Schema.Struct({
  sessionID: SessionID,
  requestID: QuestionID,
  answers: Schema.Array(Answer),
}).annotate({ identifier: "QuestionReplied" })

const Rejected = Schema.Struct({
  sessionID: SessionID,
  requestID: QuestionID,
}).annotate({ identifier: "QuestionRejected" })

export const Event = {
  Asked: BusEvent.define("question.asked", Request),
  Replied: BusEvent.define("question.replied", Replied),
  Rejected: BusEvent.define("question.rejected", Rejected),
}

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

const QUESTION_REQUEST_METADATA = "questionRequest"

type QuestionToolPart = {
  request: Request
  part: MessageV2.ToolPart
}

const cloneAnswers = (answers: ReadonlyArray<Answer>) =>
  answers.map((answer) => answer.map((part) => (typeof part === "string" ? part : { ...part })))

const formatAnswerPart = (part: Part) => {
  if (typeof part === "string") return part
  return part.filename ? `[image: ${part.filename}]` : "[image]"
}

function extractBase64(url: string): string {
  const comma = url.indexOf(",")
  if (comma === -1) return url
  const body = url.slice(comma + 1)
  if (!body.startsWith("data:")) return body
  return extractBase64(body)
}

function dataUrl(url: string, mime: string) {
  if (!url.startsWith("data:")) return `data:${mime};base64,${url}`
  return `data:${mime};base64,${extractBase64(url)}`
}

function answerFile(part: Part, sessionID: SessionID, messageID: MessageID): MessageV2.FilePart | undefined {
  if (typeof part === "string") return undefined
  return {
    id: PartID.ascending(),
    sessionID,
    messageID,
    type: "file",
    mime: part.mime,
    url: dataUrl(part.url, part.mime),
    filename: part.filename,
  }
}

const formatAnsweredOutput = (request: Request, answers: ReadonlyArray<Answer>) => {
  const formatted = request.questions
    .map(
      (q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].map(formatAnswerPart).join(", ") : "Unanswered"}"`,
    )
    .join(", ")

  return {
    title: `Asked ${request.questions.length} question${request.questions.length > 1 ? "s" : ""}`,
    output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
  }
}

const stateMetadata = (part: MessageV2.ToolPart): Record<string, any> =>
  part.state.status === "running" || part.state.status === "completed" || part.state.status === "error"
    ? (part.state.metadata ?? {})
    : {}

const requestFromPart = (part: MessageV2.Part): QuestionToolPart | undefined => {
  if (part.type !== "tool") return
  if (part.state.status !== "running" && part.state.status !== "pending") return
  const raw = stateMetadata(part)[QUESTION_REQUEST_METADATA]
  if (!isRequest(raw)) return
  return { request: raw, part }
}

const withoutQuestionRequest = (metadata: Record<string, any>) => {
  const next = { ...metadata }
  delete next[QUESTION_REQUEST_METADATA]
  return next
}

const waitForToolPart = Effect.fn("Question.waitForToolPart")(function* (
  request: Request,
  find: (request: Request) => Effect.Effect<MessageV2.ToolPart | undefined>,
  shouldContinue: (requestID: QuestionID) => Effect.Effect<boolean>,
) {
  const deadline = Date.now() + 500
  for (;;) {
    const part = yield* find(request)
    if (part || Date.now() >= deadline) return part
    if (!(yield* shouldContinue(request.id))) return undefined
    yield* Effect.sleep("20 millis")
  }
})

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
  }) => Effect.Effect<void, NotFoundError>
  readonly reject: (requestID: QuestionID) => Effect.Effect<void, NotFoundError>
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

    const findToolPart = Effect.fn("Question.findToolPart")(function* (request: Request) {
      const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
      if (!session || !request.tool) return
      return yield* Effect.gen(function* () {
        const messages = yield* session.messages({ sessionID: request.sessionID })
        for (const message of messages) {
          if (message.info.id !== request.tool?.messageID) continue
          for (const part of message.parts) {
            if (
              part.type === "tool" &&
              part.messageID === request.tool.messageID &&
              part.callID === request.tool.callID &&
              (part.state.status === "running" || part.state.status === "pending")
            ) {
              return part
            }
          }
        }
        return undefined
      }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))
    })

    const isPending = Effect.fn("Question.isPending")(function* (requestID: QuestionID) {
      return (yield* InstanceState.get(state)).pending.has(requestID)
    })

    const persistRequest = Effect.fn("Question.persistRequest")(function* (input: {
      request: Request
      waitForPart: boolean
    }) {
      return yield* Effect.gen(function* () {
        const { request } = input
        const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
        if (!session) return false
        const part = input.waitForPart
          ? yield* waitForToolPart(request, findToolPart, isPending)
          : yield* findToolPart(request)
        if (!part) {
          if (request.tool && input.waitForPart && (yield* isPending(request.id))) {
            log.warn("failed to persist question request", {
              requestID: request.id,
              sessionID: request.sessionID,
              messageID: request.tool.messageID,
              callID: request.tool.callID,
            })
          }
          return false
        }
        if (!(yield* isPending(request.id))) return false

        const metadata = {
          ...stateMetadata(part),
          [QUESTION_REQUEST_METADATA]: request,
        }
        const partInput = part.state.input ?? { questions: request.questions }
        const next: MessageV2.ToolPart =
          part.state.status === "running"
            ? {
                ...part,
                state: {
                  ...part.state,
                  input: partInput,
                  metadata,
                },
              }
            : {
                ...part,
                state: {
                  status: "running",
                  input: partInput,
                  metadata,
                  time: { start: Date.now() },
                },
              }
        yield* session.updatePart(next)
        if (yield* isPending(request.id)) return true
        const latest = yield* findToolPart(request)
        if (latest?.state.status === "running") {
          yield* session.updatePart({
            ...latest,
            state: {
              ...latest.state,
              metadata: withoutQuestionRequest(latest.state.metadata ?? {}),
            },
          })
        }
        return false
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.sync(() => {
            log.warn("question request persist failed", { cause })
            return false
          }),
        ),
      )
    })

    const clearPersistedRequest = Effect.fn("Question.clearPersistedRequest")(function* (request: Request) {
      yield* Effect.gen(function* () {
        const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
        if (!session) return
        const part = yield* findToolPart(request)
        if (!part || part.state.status !== "running") return
        yield* session.updatePart({
          ...part,
          state: {
            ...part.state,
            metadata: withoutQuestionRequest(part.state.metadata ?? {}),
          },
        })
      }).pipe(Effect.catchCause((cause) => Effect.sync(() => log.warn("question request clear failed", { cause }))))
    })

    const persisted = Effect.fn("Question.persisted")(function* () {
      const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
      if (!session) return []
      const result: QuestionToolPart[] = []
      const sessions = yield* session.list({ limit: 1000 })
      for (const item of sessions) {
        const messages = yield* session
          .messages({ sessionID: item.id })
          .pipe(Effect.catchCause(() => Effect.succeed([])))
        for (const message of messages) {
          for (const part of message.parts) {
            const request = requestFromPart(part)
            if (request) result.push(request)
          }
        }
      }
      return result
    })

    const findPersisted = Effect.fn("Question.findPersisted")(function* (requestID: QuestionID) {
      for (const item of yield* persisted()) {
        if (item.request.id === requestID) return item
      }
      return undefined
    })

    const completePersisted = Effect.fn("Question.completePersisted")(function* (
      item: QuestionToolPart,
      answers: ReadonlyArray<Answer>,
    ) {
      const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
      if (!session) return
      const now = Date.now()
      const input = item.part.state.input ?? { questions: item.request.questions }
      const time =
        item.part.state.status === "running"
          ? { start: item.part.state.time.start, end: now }
          : { start: now, end: now }
      const output = formatAnsweredOutput(item.request, answers)
      const attachments = answers.flatMap((answer) =>
        answer.flatMap((part) => {
          const next = answerFile(part, item.part.sessionID, item.part.messageID)
          return next ? [next] : []
        }),
      )
      yield* session.updatePart({
        ...item.part,
        state: {
          status: "completed",
          input,
          title: output.title,
          output: output.output,
          metadata: {
            ...withoutQuestionRequest(stateMetadata(item.part)),
            answers: cloneAnswers(answers),
          },
          time,
          attachments: attachments.length ? attachments : undefined,
        },
      })
    })

    const rejectPersisted = Effect.fn("Question.rejectPersisted")(function* (item: QuestionToolPart) {
      const session = EffectOption.getOrUndefined(yield* Effect.serviceOption(Session.Service))
      if (!session) return
      const now = Date.now()
      const input = item.part.state.input ?? { questions: item.request.questions }
      const time =
        item.part.state.status === "running"
          ? { start: item.part.state.time.start, end: now }
          : { start: now, end: now }
      yield* session.updatePart({
        ...item.part,
        state: {
          status: "error",
          input,
          error: new RejectedError().message,
          metadata: withoutQuestionRequest(stateMetadata(item.part)),
          time,
        },
      })
    })

    const ask = Effect.fn("Question.ask")(function* (input: {
      sessionID: SessionID
      questions: ReadonlyArray<Info>
      tool?: Tool
    }) {
      const pending = (yield* InstanceState.get(state)).pending
      const id = QuestionID.ascending()
      log.info("asking", { id, questions: input.questions.length })

      const deferred = yield* Deferred.make<ReadonlyArray<Answer>, RejectedError>()
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      pending.set(id, { info, deferred })
      const persisted = yield* persistRequest({ request: info, waitForPart: false })
      yield* bus.publish(Event.Asked, info)
      if (!persisted && info.tool) yield* persistRequest({ request: info, waitForPart: true })

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
        const recovered = yield* findPersisted(input.requestID)
        if (!recovered) {
          log.warn("reply for unknown request", { requestID: input.requestID })
          return yield* new NotFoundError({ requestID: input.requestID })
        }
        yield* completePersisted(recovered, input.answers)
        log.info("replied recovered question", { requestID: input.requestID, answers: input.answers })
        yield* bus.publish(Event.Replied, {
          sessionID: recovered.request.sessionID,
          requestID: recovered.request.id,
          answers: cloneAnswers(input.answers),
        })
        return
      }
      pending.delete(input.requestID)
      yield* clearPersistedRequest(existing.info)
      log.info("replied", { requestID: input.requestID, answers: input.answers })
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        answers: cloneAnswers(input.answers),
      })
      yield* Deferred.succeed(existing.deferred, input.answers)
    })

    const reject = Effect.fn("Question.reject")(function* (requestID: QuestionID) {
      const pending = (yield* InstanceState.get(state)).pending
      const existing = pending.get(requestID)
      if (!existing) {
        const recovered = yield* findPersisted(requestID)
        if (!recovered) {
          log.warn("reject for unknown request", { requestID })
          return yield* new NotFoundError({ requestID })
        }
        yield* rejectPersisted(recovered)
        log.info("rejected recovered question", { requestID })
        yield* bus.publish(Event.Rejected, {
          sessionID: recovered.request.sessionID,
          requestID: recovered.request.id,
        })
        return
      }
      pending.delete(requestID)
      yield* clearPersistedRequest(existing.info)
      log.info("rejected", { requestID })
      yield* bus.publish(Event.Rejected, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
      })
      yield* Deferred.fail(existing.deferred, new RejectedError())
    })

    const list = Effect.fn("Question.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      const result = Array.from(pending.values(), (x) => x.info)
      const seen = new Set(result.map((item) => item.id))
      for (const item of yield* persisted()) {
        if (seen.has(item.request.id)) continue
        seen.add(item.request.id)
        result.push(item.request)
      }
      return result
    })

    return Service.of({ ask, reply, reject, list })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Question from "."
