import { describe, expect, test } from "bun:test"
import { Effect, Schema, Stream } from "effect"
import { ai, LanguageModel, LLMEvent, ProviderInternalError, tool } from "../src/effect.js"
import { AI, AIError } from "../src/index.js"
import { OpenAIChat } from "../src/protocols/openai-chat.js"
import { TestLLM } from "../src/testing.js"
import { testEffect } from "./lib/effect.js"

const model = LanguageModel.make({ id: "fictional-model", provider: "fixture", route: OpenAIChat.route })
const it = testEffect(TestLLM.testLayer())
const overloaded = new AIError({ reason: new ProviderInternalError({ message: "Overloaded" }) })

const textThenFail = TestLLM.failAfter(
  overloaded,
  LLMEvent.stepStart({ index: 0 }),
  LLMEvent.textStart({ id: "text-0" }),
  LLMEvent.textDelta({ id: "text-0", text: "Partial answer" }),
  LLMEvent.stepFinish({
    index: 0,
    reason: { normalized: "stop" },
    usage: { inputTokens: 5, nonCachedInputTokens: 5, outputTokens: 2 },
  }),
)

describe("AIError.partial", () => {
  it.effect("generate keeps the output that arrived before a mid-stream failure", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(textThenFail)

      const error = yield* ai.generate({ model, prompt: "Hello" }).pipe(Effect.flip)

      expect(error.reason).toBe(overloaded.reason)
      expect(error.partial?.text).toBe("Partial answer")
      expect(error.partial?.message.content).toEqual([{ type: "text", text: "Partial answer" }])
      expect(error.partial?.usage?.outputTokens).toBe(2)
      expect(error.partial?.finishReason).toEqual({ normalized: "error" })
    }),
  )

  it.effect("generate keeps the same error when the failure comes before any output", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.failAfter(overloaded, LLMEvent.stepStart({ index: 0 })))

      expect(yield* ai.generate({ model, prompt: "Hello" }).pipe(Effect.flip)).toBe(overloaded)
    }),
  )

  it.effect("generateObject keeps the raw output when the token limit cuts off the forced tool call", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(
        TestLLM.complete(
          { reason: { normalized: "length" } },
          LLMEvent.textStart({ id: "text-0" }),
          LLMEvent.textDelta({ id: "text-0", text: "Thinking about the answer" }),
        ),
      )

      const error = yield* ai
        .generateObject({
          model,
          prompt: "Answer",
          schema: Schema.Struct({ answer: Schema.String }),
        })
        .pipe(Effect.flip)

      expect(error.message).toContain("token limit")
      expect(error.partial?.text).toBe("Thinking about the answer")
      expect(error.partial?.finishReason.normalized).toBe("length")
    }),
  )

  it.effect("loop reports only the failed step as partial", () =>
    Effect.gen(function* () {
      const client = yield* TestLLM.Test
      yield* client.push(TestLLM.toolCall("call-1", "echo", { value: "hi" }))
      yield* client.push(textThenFail)

      const echo = tool({
        description: "Echo a value.",
        parameters: Schema.Struct({ value: Schema.String }),
        success: Schema.String,
        execute: ({ value }) => Effect.succeed(value),
      })
      const error = yield* ai.loop({ model, prompt: "Echo hi.", tools: { echo } }).pipe(Stream.runDrain, Effect.flip)

      expect(error.partial?.text).toBe("Partial answer")
      expect(error.partial?.toolCalls).toEqual([])
    }),
  )
})

describe("AIError.partial from the promise client", () => {
  test("rejects with the root-exported AIError carrying partial", async () => {
    const client = AI.make({ clients: TestLLM.testLayer({ fallback: textThenFail }) })

    const error = await client.generate({ model, prompt: "Hello" }).catch((error: unknown) => error)

    expect(error).toBeInstanceOf(AIError)
    expect(error instanceof AIError && error.partial?.text).toBe("Partial answer")
    await client.dispose()
  })
})
