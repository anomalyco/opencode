import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import { normalizeQuestionsInput, QuestionTool } from "../../src/tool/question"
import * as QuestionModule from "../../src/question"
import { SessionID, MessageID } from "../../src/session/schema"

const ctx = {
  sessionID: SessionID.make("ses_test-session"),
  messageID: MessageID.make("test-message"),
  callID: "test-call",
  agent: "test-agent",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.question", () => {
  let askSpy: any

  beforeEach(() => {
    askSpy = spyOn(QuestionModule.Question, "ask").mockImplementation(async () => {
      return []
    })
  })

  afterEach(() => {
    askSpy.mockRestore()
  })

  test("should successfully execute with valid question parameters", async () => {
    const tool = await QuestionTool.init()
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

    askSpy.mockResolvedValueOnce([["Red"]])

    const result = await tool.execute({ questions }, ctx)
    expect(askSpy).toHaveBeenCalledTimes(1)
    expect(result.title).toBe("Asked 1 question")
  })

  test("should now pass with a header longer than 12 but less than 30 chars", async () => {
    const tool = await QuestionTool.init()
    const questions = [
      {
        question: "What is your favorite animal?",
        header: "This Header is Over 12",
        options: [{ label: "Dog", description: "Man's best friend" }],
      },
    ]

    askSpy.mockResolvedValueOnce([["Dog"]])

    const result = await tool.execute({ questions }, ctx)
    expect(result.output).toContain(`"What is your favorite animal?"="Dog"`)
  })

  test("should parse a stringified questions array", async () => {
    const tool = await QuestionTool.init()

    askSpy.mockResolvedValueOnce([["TypeScript"]])

    const input = {
      questions: `[
        {
          "question": "Which language should we use?",
          "header": "Stack",
          "options": [
            { "label": "TypeScript", "description": "Use TypeScript" }
          ]
        }
      ]`,
    } as unknown as Parameters<typeof tool.execute>[0]

    const result = await tool.execute(input, ctx)

    expect(askSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            question: "Which language should we use?",
            header: "Stack",
          }),
        ],
      }),
    )
    expect(result.output).toContain(`"Which language should we use?"="TypeScript"`)
  })

  test("should wrap a single question object into an array", async () => {
    const tool = await QuestionTool.init()

    askSpy.mockResolvedValueOnce([["Python"]])

    const input = {
      questions: {
        question: "Which language should we use?",
        header: "Stack",
        options: [{ label: "Python", description: "Use Python" }],
      },
    } as unknown as Parameters<typeof tool.execute>[0]

    await tool.execute(input, ctx)

    expect(askSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            question: "Which language should we use?",
          }),
        ],
      }),
    )
  })

  test("should convert a plain string into a free-form question", async () => {
    const tool = await QuestionTool.init()

    askSpy.mockResolvedValueOnce([["Rust"]])

    const input = {
      questions: "Which language should we use?",
    } as unknown as Parameters<typeof tool.execute>[0]

    await tool.execute(input, ctx)

    expect(askSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        questions: [
          expect.objectContaining({
            question: "Which language should we use?",
            options: [],
          }),
        ],
      }),
    )
  })

  test("should normalize a multiline free-form question into a single question", () => {
    const normalized = normalizeQuestionsInput(`次の作業を進める前に確認したいです。
どの言語で実装したいですか？`)

    expect(normalized).toEqual([
      {
        question:
          "次の作業を進める前に確認したいです。\nどの言語で実装したいですか？",
        header: "次の作業を進める前に確認したいです。",
        options: [],
      },
    ])
  })

  test("[issue #67] Qwen's truncated-JSON input collapses to a single question", () => {
    // Qwen occasionally emits `questions` as an unterminated JSON string; the
    // state.input used by the TUI used to receive this raw string and render
    // "Asked N questions" where N was the string length.
    const qwenInput =
      '\n\n[{"header": "具体的内容", "question": "TypeScript/JavaScriptに関する具体的な質問は何ですか？\n\n'
    const normalized = normalizeQuestionsInput(qwenInput)
    expect(Array.isArray(normalized)).toBe(true)
    expect((normalized as unknown[]).length).toBe(1)
  })

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
