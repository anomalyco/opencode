import { describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { QuestionV2 } from "@opencode-ai/core/question"
import { SessionV2 } from "@opencode-ai/core/session"
import { ToolRegistry } from "@opencode-ai/core/tool-registry"
import { QuestionTool } from "@opencode-ai/core/tool/question"
import { testEffect } from "./lib/effect"

const sessionID = SessionV2.ID.make("ses_question_tool_test")
const assertions: PermissionV2.AssertInput[] = []
let captured: QuestionV2.AskInput | undefined
let reject = false
const capturedInput = () => captured
const permission = Layer.succeed(
  PermissionV2.Service,
  PermissionV2.Service.of({
    assert: (input) => Effect.sync(() => assertions.push(input)),
    ask: () => Effect.die("unused"),
    reply: () => Effect.die("unused"),
    get: () => Effect.die("unused"),
    forSession: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const registry = ToolRegistry.layer.pipe(Layer.provide(permission))
const question = Layer.succeed(
  QuestionV2.Service,
  QuestionV2.Service.of({
    ask: (input: QuestionV2.AskInput) =>
      Effect.sync(() => {
        captured = input
      }).pipe(Effect.andThen(reject ? Effect.fail(new QuestionV2.RejectedError()) : Effect.succeed([["Build"], []]))),
    reply: () => Effect.die("unused"),
    reject: () => Effect.die("unused"),
    list: () => Effect.die("unused"),
  }),
)
const tool = QuestionTool.layer.pipe(Layer.provide(registry), Layer.provide(question))
const it = testEffect(Layer.mergeAll(permission, registry, question, tool))

describe("QuestionTool", () => {
  it.effect("registers question and projects user answers without a permission assertion", () =>
    Effect.gen(function* () {
      assertions.length = 0
      captured = undefined
      reject = false
      const registry = yield* ToolRegistry.Service
      const questions = [
        {
          question: "What should happen?",
          header: "Action",
          options: [{ label: "Build", description: "Build it" }],
        },
        {
          question: "Which environment?",
          header: "Environment",
          options: [{ label: "Dev", description: "Development" }],
        },
      ]

      expect((yield* registry.definitions()).map((definition) => definition.name)).toEqual(["question"])
      expect(
        yield* registry.settle({
          sessionID,
          call: { type: "tool-call", id: "call-question", name: "question", input: { questions } },
        }),
      ).toEqual({
        result: {
          type: "text",
          value:
            'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered". You can now continue with the user\'s answers in mind.',
        },
        output: {
          structured: { answers: [["Build"], []] },
          content: [
            {
              type: "text",
              text: 'User has answered your questions: "What should happen?"="Build", "Which environment?"="Unanswered". You can now continue with the user\'s answers in mind.',
            },
          ],
        },
      })
      expect(assertions).toEqual([])
      expect(capturedInput()).toEqual({ sessionID, questions, tool: undefined })
    }),
  )

  it.effect("does not invent tool ownership metadata without a durable registry source", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = false
      const registryService = yield* ToolRegistry.Service

      yield* registryService.execute({
        sessionID,
        call: { type: "tool-call", id: "call-question", name: "question", input: { questions: [] } },
      })
      expect(capturedInput()).toEqual({ sessionID, questions: [], tool: undefined })
    }),
  )

  it.effect("keeps dismissed questions out of model-facing output", () =>
    Effect.gen(function* () {
      captured = undefined
      reject = true
      const registryService = yield* ToolRegistry.Service
      const fiber = yield* registryService
        .execute({
          sessionID,
          call: { type: "tool-call", id: "call-question", name: "question", input: { questions: [] } },
        })
        .pipe(Effect.forkScoped)

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
  )
})
