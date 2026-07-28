import { describe, expect } from "bun:test"
import { Context, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/util/effect/layer-node"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/event"
import { Question } from "@opencode-ai/core/question"
import { Session } from "@opencode-ai/core/session"
import { testEffect } from "./lib/effect"

const questions = AppNodeBuilder.build(LayerNode.group([Bus.node, Question.node]))
const it = testEffect(questions)

const sessionID = Session.ID.make("ses_question_test")
const question: Question.Info = {
  question: "Which option?",
  header: "Option",
  options: [{ label: "One", description: "First option" }],
}

const waitForAsk = Effect.fn("QuestionTest.waitForAsk")(function* (
  service: Question.Interface,
  input: Question.AskInput,
) {
  const bus = yield* Bus.Service
  const asked = yield* Deferred.make<Question.Request>()
  const unsubscribe = yield* bus.listen((event) =>
    event.type === Question.Event.Asked.type
      ? Deferred.succeed(asked, event.data as Question.Request).pipe(Effect.asVoid)
      : Effect.void,
  )
  yield* Effect.addFinalizer(() => unsubscribe)
  const fiber = yield* service.ask(input).pipe(Effect.forkScoped)
  return { fiber, request: yield* Deferred.await(asked) }
})

describe("Question", () => {
  it.effect("publishes lifecycle events and settles a pending reply", () =>
    Effect.gen(function* () {
      const service = yield* Question.Service
      const bus = yield* Bus.Service
      const published: Event.Payload[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type.startsWith("question.")) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      expect(request.id).toMatch(/^que_/)
      expect(yield* service.list()).toEqual([request])
      yield* service.reply({ requestID: request.id, answers: [["One"]] })

      expect(yield* Fiber.join(fiber)).toEqual([["One"]])
      expect(yield* service.list()).toEqual([])
      expect(published.map((event) => [event.type, event.data])).toEqual([
        [Question.Event.Asked.type, request],
        [Question.Event.Replied.type, { sessionID, requestID: request.id, answers: [["One"]] }],
      ])
    }),
  )

  it.effect("publishes rejection, fails the ask, and rejects unknown IDs", () =>
    Effect.gen(function* () {
      const service = yield* Question.Service
      const bus = yield* Bus.Service
      const published: Event.Payload[] = []
      const unsubscribe = yield* bus.listen((event) =>
        Effect.sync(() => {
          if (event.type === Question.Event.Rejected.type) published.push(event)
        }),
      )
      yield* Effect.addFinalizer(() => unsubscribe)
      const { fiber, request } = yield* waitForAsk(service, { sessionID, questions: [question] })

      yield* service.reject(request.id)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("Question.RejectedError")
      expect(published.map((event) => event.data)).toEqual([{ sessionID, requestID: request.id }])

      const unknown = Question.ID.ascending("que_unknown")
      expect(yield* service.reply({ requestID: unknown, answers: [] }).pipe(Effect.flip)).toEqual(
        new Question.NotFoundError({ requestID: unknown }),
      )
      expect(yield* service.reject(unknown).pipe(Effect.flip)).toEqual(
        new Question.NotFoundError({ requestID: unknown }),
      )
    }),
  )

  it.effect("isolates pending requests by location-layer instance and rejects them on finalization", () =>
    Effect.gen(function* () {
      const firstScope = yield* Scope.make()
      const secondScope = yield* Scope.make()
      const first = Context.get(yield* Layer.buildWithScope(Layer.fresh(questions), firstScope), Question.Service)
      const second = Context.get(yield* Layer.buildWithScope(Layer.fresh(questions), secondScope), Question.Service)
      const fiber = yield* first.ask({ sessionID, questions: [question] }).pipe(Effect.forkScoped)
      yield* Effect.yieldNow
      const request = (yield* first.list())[0]!

      expect(yield* second.list()).toEqual([])
      expect(yield* second.reply({ requestID: request.id, answers: [["One"]] }).pipe(Effect.flip)).toEqual(
        new Question.NotFoundError({ requestID: request.id }),
      )

      yield* Scope.close(firstScope, Exit.void)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(exit.cause.toString()).toContain("Question.RejectedError")
      yield* Scope.close(secondScope, Exit.void)
    }),
  )
})
