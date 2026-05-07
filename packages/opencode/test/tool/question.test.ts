import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { QuestionTool } from "../../src/tool/question"
import { Question } from "../../src/question"
import { SessionID, MessageID } from "../../src/session/schema"
import { Agent } from "../../src/agent/agent"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Truncate } from "@/tool/truncate"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("test-message"),
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const it = testEffect(
  Layer.mergeAll(Question.defaultLayer, CrossSpawnSpawner.defaultLayer, Truncate.defaultLayer, Agent.defaultLayer),
)

const pending = Effect.fn("QuestionToolTest.pending")(function* (question: Question.Interface) {
  for (;;) {
    const items = yield* question.list()
    const item = items[0]
    if (item) return item
    yield* Effect.sleep("10 millis")
  }
})

describe("tool.question", () => {
  it.live("should successfully execute with valid question parameters", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const toolInfo = yield* QuestionTool
        const tool = yield* toolInfo.init()
        const questions = [
          {
            question: "What is your favorite color?",
            header: "Color",
            options: [
              { label: "Red", description: "The color of passion" },
              { label: "Blue", description: "The color of sky" },
            ],
            multiple: false,
          },
        ]

        const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
        const item = yield* pending(question)
        yield* question.reply({ requestID: item.id, answers: [["Red"]] })

        const result = yield* Fiber.join(fiber)
        expect(result.title).toBe("Asked 1 question")
      }),
    ),
  )

  it.live("should now pass with a header longer than 12 but less than 30 chars", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const toolInfo = yield* QuestionTool
        const tool = yield* toolInfo.init()
        const questions = [
          {
            question: "What is your favorite animal?",
            header: "This Header is Over 12",
            options: [{ label: "Dog", description: "Man's best friend" }],
          },
        ]

        const fiber = yield* tool.execute({ questions }, ctx).pipe(Effect.forkScoped)
        const item = yield* pending(question)
        yield* question.reply({ requestID: item.id, answers: [["Dog"]] })

        const result = yield* Fiber.join(fiber)
        expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
      }),
    ),
  )

  // Issue #100: qwen3.6 が `options:[]` のときに `questions` を JSON 文字列で送るケース。
  // schema preprocess (normalizeQuestionsInput) が execute() 入口で吸収して、
  // 通常の質問フローへ進むことを保証する。
  it.live("normalizes Qwen-style stringified JSON questions input (#100)", () =>
    provideTmpdirInstance(() =>
      Effect.gen(function* () {
        const question = yield* Question.Service
        const toolInfo = yield* QuestionTool
        const tool = yield* toolInfo.init()

        // 実ログ (#100 / Test B) と同じ形式: surrounding newlines + JSON 文字列 + options:[]
        const stringifiedInput =
          '\n[{"question": "このタスクの実装言語は何ですか？", "header": "実装言語", "options": [], "multiple": false}]\n'

        const fiber = yield* tool
          .execute({ questions: stringifiedInput } as unknown as Parameters<typeof tool.execute>[0], ctx)
          .pipe(Effect.forkScoped)
        const item = yield* pending(question)
        // 自由入力ケース: ユーザーが文字列で答える
        yield* question.reply({ requestID: item.id, answers: [["TypeScript"]] })

        const result = yield* Fiber.join(fiber)
        expect(result.title).toBe("Asked 1 question")
        expect(result.output).toContain(`"このタスクの実装言語は何ですか？"="TypeScript"`)
      }),
    ),
  )

  it.live("formatValidationError mentions canonical array shape and options-omission rule", () =>
    Effect.gen(function* () {
      const toolInfo = yield* QuestionTool
      const tool = yield* toolInfo.init()
      const msg = tool.formatValidationError!("dummy SchemaError(...)")
      expect(msg).toContain("must be a JSON array")
      expect(msg).toContain('"question"')
      expect(msg).toContain("omit the \"options\" field")
    }),
  )

  // intentionally removed the zod validation due to tool call errors, hoping prompting is gonna be good enough
  //   test("should throw an Error for header exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "What is your favorite animal?",
  //         header: "This Header is Definitely More Than Thirty Characters Long",
  //         options: [{ label: "Dog", description: "Man's best friend" }],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })

  //   test("should throw an Error for label exceeding 30 characters", async () => {
  //     const tool = await QuestionTool.init()
  //     const questions = [
  //       {
  //         question: "A question with a very long label",
  //         header: "Long Label",
  //         options: [
  //           { label: "This is a very, very, very long label that will exceed the limit", description: "A description" },
  //         ],
  //       },
  //     ]
  //     try {
  //       await tool.execute({ questions }, ctx)
  //       // If it reaches here, the test should fail
  //       expect(true).toBe(false)
  //     } catch (e: any) {
  //       expect(e).toBeInstanceOf(Error)
  //       expect(e.cause).toBeInstanceOf(z.ZodError)
  //     }
  //   })
})
