import { describe, expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { LLMAISDK } from "@/session/llm/ai-sdk"

type ErrorEvent = Extract<Parameters<typeof LLMAISDK.toLLMEvents>[1], { type: "error" }>

const errorEvent = (error: unknown): ErrorEvent => ({ type: "error", error })

const run = (error: unknown) => Effect.runPromiseExit(LLMAISDK.toLLMEvents(LLMAISDK.adapterState(), errorEvent(error)))

describe("LLMAISDK.toLLMEvents error handling", () => {
  test("drops orphan reasoning/text stream-state errors without failing the turn", async () => {
    // vercel/ai stream-text.ts enqueues these exact strings as non-fatal in-band
    // error parts when a reasoning/text delta (or its end) has no preceding
    // *-start block. They must not abort the assistant turn.
    for (const message of [
      "reasoning part 0 not found",
      "reasoning part 7 not found",
      "reasoning part rs_abc:0 not found",
      "text part 0 not found",
      "text part X not found",
    ]) {
      const exit = await run(message)
      expect(Exit.isSuccess(exit)).toBe(true)
      if (Exit.isSuccess(exit)) expect(exit.value).toEqual([])
    }
  })

  test("tolerates surrounding whitespace via trim", async () => {
    const exit = await run("  reasoning part 0 not found  ")
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  test("still fails on genuine provider errors", async () => {
    for (const error of ["rate limit exceeded", 'Tool "foo" not found', "context length exceeded", new Error("boom")]) {
      const exit = await run(error)
      expect(Exit.isFailure(exit)).toBe(true)
    }
  })
})
