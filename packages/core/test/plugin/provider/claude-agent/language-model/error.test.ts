import { describe, expect, spyOn, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKAssistantMessage, SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk"
import { AIError } from "@opencode/ai/effect"
import { ModelRetry } from "@opencode/core/model-retry"
import { ConvertClaudeStream } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-claude-stream"
import { Effect, Fiber, Result } from "effect"
import { TestClock } from "effect/testing"
import { it } from "../../../../lib/effect"
import { Recorder } from "../lib/recorder"

function assistant() {
  const line = Recorder.load("billing-error").find(
    (line) => line.from === "claude" && line.message.type === "assistant" && line.message.error,
  )!
  if (line.from !== "claude") throw new Error("Expected a recorded assistant error")
  return line.message as SDKAssistantMessage
}

describe("terminal errors", () => {
  test("a recorded failed turn ends in an error after its text, without a finish", () => {
    const convert = ConvertClaudeStream.make([])
    const parts: LanguageModelV3StreamPart[] = []
    for (const line of Recorder.load("text-cancel")) {
      if (line.from !== "claude" || line.message.type === "control_response") continue
      parts.push(...convert(line.message as SDKMessage))
      if (line.message.type === "result") break
    }
    expect(parts.some((part) => part.type === "text-delta")).toBe(true)
    expect(parts.at(-1)?.type).toBe("error")
    expect(parts.some((part) => part.type === "finish")).toBe(false)
  })

  test("a recorded billing failure is an error, not answer text", () => {
    const convert = ConvertClaudeStream.make([])
    expect(convert(assistant())).toEqual([])
    const parts = convert(Recorder.result("billing-error"))
    expect(parts).toEqual([{ type: "error", error: expect.any(Error) }])
    if (parts[0]?.type === "error") expect(String(parts[0].error)).toContain("extra usage")
  })

  test.each([
    {
      name: "assistant rate limit with CLI text",
      assistantError: true,
      result: "Weekly limit reached.",
      resetsAt: 1792800000,
      retryAfterMs: 1000,
      message: "Weekly limit reached. Resets at 2026-10-24T00:00:00.000Z.",
    },
    {
      name: "rejected window and HTTP 429 with fallback text",
      assistantError: false,
      result: "",
      resetsAt: 1792800000,
      retryAfterMs: 1000,
      message: "Claude Code subscription limit reached (seven day sonnet). Resets at 2026-10-24T00:00:00.000Z.",
    },
    {
      name: "assistant rate limit without a reset event",
      assistantError: true,
      result: "Weekly limit reached.",
      resetsAt: undefined,
      retryAfterMs: undefined,
      message: "Weekly limit reached.",
    },
    {
      name: "rejected window and HTTP 429 after reset",
      assistantError: false,
      result: "Weekly limit reached.",
      resetsAt: 1792799998,
      retryAfterMs: 0,
      message: "Weekly limit reached. Resets at 2026-10-23T23:59:58.000Z.",
    },
  ])("$name is a typed quota error", ({ assistantError, result, resetsAt, retryAfterMs, message }) => {
    const now = spyOn(Date, "now").mockReturnValue(1792799999000)
    try {
      const convert = ConvertClaudeStream.make([])
      if (resetsAt !== undefined || !assistantError) {
        expect(
          convert({
            type: "rate_limit_event",
            uuid: crypto.randomUUID(),
            session_id: crypto.randomUUID(),
            rate_limit_info: { status: "rejected", rateLimitType: "seven_day_sonnet", resetsAt },
          }),
        ).toEqual([])
      }
      if (assistantError) expect(convert({ ...assistant(), error: "rate_limit" } as const)).toEqual([])
      const parts = convert({
        ...Recorder.result("text"),
        subtype: "success",
        is_error: true,
        result,
        api_error_status: assistantError ? null : 429,
      } as const)
      expect(parts).toEqual([{ type: "error", error: expect.any(AIError) }])
      if (parts[0]?.type !== "error" || !(parts[0].error instanceof AIError)) throw new Error("Expected an AI error")
      expect(parts[0].error.reason._tag).toBe("QuotaExceeded")
      expect(parts[0].error.message).toBe(message)
      expect(parts[0].error.retryAfterMs).toBe(retryAfterMs)
    } finally {
      now.mockRestore()
    }
  })

  it.effect("generation does not retry an exhausted Claude subscription", () =>
    Effect.gen(function* () {
      const convert = ConvertClaudeStream.make([])
      convert({
        type: "rate_limit_event",
        uuid: crypto.randomUUID(),
        session_id: crypto.randomUUID(),
        rate_limit_info: {
          status: "rejected",
          rateLimitType: "five_hour",
          resetsAt: Math.floor(Date.now() / 1000) + 18_000,
        },
      })
      const [part] = convert({
        ...Recorder.result("text"),
        subtype: "success",
        is_error: true,
        api_error_status: 429,
        result: "",
      } as const)
      const error = part?.type === "error" ? part.error : undefined
      if (!(error instanceof AIError)) throw new Error("Expected a subscription error")
      const results = yield* Effect.forEach([ModelRetry.retry, ModelRetry.retryOneShot], (retry) =>
        Effect.gen(function* () {
          let calls = 0
          const attempt = Effect.suspend(() => (++calls === 1 ? Effect.fail(error) : Effect.succeed("retried")))
          const run = yield* Effect.forkChild(retry(attempt).pipe(Effect.result), { startImmediately: true })
          yield* TestClock.adjust("15 minutes")
          return { result: yield* Fiber.join(run), calls }
        }),
      )
      expect(results).toEqual([
        { result: Result.fail(error), calls: 1 },
        { result: Result.fail(error), calls: 1 },
      ])
    }),
  )

  test("allowed windows and successful turns do not retain rejected limits", () => {
    const info = {
      type: "rate_limit_event",
      uuid: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      rate_limit_info: { status: "rejected", rateLimitType: "seven_day_sonnet", resetsAt: 1792800000 },
    } satisfies SDKRateLimitEvent
    for (const status of ["allowed", "allowed_warning", "rejected"] as const) {
      const successful = ConvertClaudeStream.make([])
      successful({ ...info, rate_limit_info: { ...info.rate_limit_info, status, overageStatus: "allowed" } } as const)
      expect(successful(Recorder.result("text")).at(-1)?.type).toBe("finish")
    }
    const recovered = ConvertClaudeStream.make([])
    recovered(info)
    recovered({ ...info, rate_limit_info: { status: "allowed", overageStatus: "rejected" } } as const)
    const later = recovered({
      ...Recorder.result("text"),
      subtype: "success",
      is_error: true,
      result: "Weekly limit reached.",
      api_error_status: 429,
    } as const)
    if (later[0]?.type !== "error") throw new Error("Expected a terminal error")
    expect(later[0].error).not.toBeInstanceOf(AIError)
    expect(String(later[0].error)).toBe("Error: Weekly limit reached.")
  })

  test("empty successes after API retries report the terminal HTTP status", () => {
    for (const status of [500, 529]) {
      const convert = ConvertClaudeStream.make([])
      const result = {
        ...Recorder.result("text"),
        subtype: "success",
        is_error: false,
        result: "",
        api_error_status: status,
      } as const
      const parts = convert(result)
      if (parts[0]?.type !== "error") throw new Error("Expected an API error")
      expect(String(parts[0].error)).toContain(String(status))
      expect(String(parts[0].error)).toContain("retries")
      expect(parts.some((part) => part.type === "finish")).toBe(false)
    }
    const empty = {
      ...Recorder.result("text"),
      subtype: "success",
      result: "",
      is_error: false,
      api_error_status: null,
    } as const
    expect(ConvertClaudeStream.make([])(empty).at(-1)?.type).toBe("finish")
  })
})
