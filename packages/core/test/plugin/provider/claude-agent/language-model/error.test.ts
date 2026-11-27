import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKAssistantMessage, SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk"
import { ConvertClaudeStream } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-claude-stream"
import { Recorder } from "../lib/recorder"

function assistant() {
  const line = Recorder.load("api-error").find(
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

  test("a recorded API error is an error, not answer text", () => {
    const convert = ConvertClaudeStream.make([])
    expect(convert(assistant())).toEqual([])
    const parts = convert(Recorder.result("api-error"))
    expect(parts).toEqual([{ type: "error", error: expect.any(Error) }])
    if (parts[0]?.type === "error") expect(String(parts[0].error)).toContain("claude-does-not-exist")
  })

  test("a rejected weekly window gives its reset date, while allowed windows do not fail", () => {
    const info = {
      type: "rate_limit_event",
      uuid: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
      rate_limit_info: { status: "rejected", rateLimitType: "seven_day_sonnet", resetsAt: 1792800000 },
    } satisfies SDKRateLimitEvent
    const convert = ConvertClaudeStream.make([])
    expect(convert(info)).toEqual([])
    expect(convert({ ...assistant(), error: "rate_limit" } as const)).toEqual([])
    const failed = {
      ...Recorder.result("text"),
      subtype: "success",
      is_error: true,
      result: "Weekly limit reached.",
    } as const
    const parts = convert(failed)
    if (parts[0]?.type !== "error") throw new Error("Expected a limit error")
    expect(String(parts[0].error)).toContain(new Date(info.rate_limit_info.resetsAt * 1000).toISOString())
    for (const status of ["allowed", "allowed_warning", "rejected"] as const) {
      const successful = ConvertClaudeStream.make([])
      successful({ ...info, rate_limit_info: { ...info.rate_limit_info, status, overageStatus: "allowed" } } as const)
      expect(successful(Recorder.result("text")).at(-1)?.type).toBe("finish")
    }
    const recovered = ConvertClaudeStream.make([])
    recovered(info)
    recovered({ ...info, rate_limit_info: { status: "allowed", overageStatus: "rejected" } } as const)
    const later = recovered({ ...failed, api_error_status: 429 })
    if (later[0]?.type !== "error") throw new Error("Expected a terminal error")
    expect(String(later[0].error)).not.toContain("Resets at")
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

  test("a non-error synthetic placeholder is ignored and fails the turn when no real reply arrived", () => {
    const { error: _error, ...base } = assistant()
    const synthetic: SDKAssistantMessage = {
      ...base,
      message: {
        ...base.message,
        model: "<synthetic>",
        stop_reason: "stop_sequence",
        usage: {
          ...base.message.usage,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        content: [{ type: "text", text: "No response requested.", citations: null }],
      },
    }
    const convert = ConvertClaudeStream.make([])
    expect(convert(synthetic)).toEqual([])
    const result = {
      ...Recorder.result("text"),
      subtype: "success",
      is_error: false,
      api_error_status: null,
      stop_reason: "stop_sequence",
      result: "No response requested.",
      usage: {
        ...Recorder.result("text").usage,
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    } as const
    const parts = convert(result)
    expect(parts).toEqual([{ type: "error", error: expect.any(Error) }])
    if (parts[0]?.type === "error") expect(String(parts[0].error)).toContain("Claude Code returned no response.")
    expect(parts.some((part) => part.type === "finish" || part.type === "text-delta")).toBe(false)

    // Billing/API synthetic errors still surface their actual error message.
    const billing = ConvertClaudeStream.make([])
    expect(billing({ ...assistant(), error: "billing_error" } as const)).toEqual([])
    const billingParts = billing({
      ...Recorder.result("api-error"),
      subtype: "success",
      is_error: true,
      api_error_status: 400,
      result: "Credit balance is too low",
    } as const)
    expect(billingParts).toEqual([{ type: "error", error: expect.any(Error) }])
    if (billingParts[0]?.type === "error") expect(String(billingParts[0].error)).toContain("Credit balance is too low")
  })

  test("a trailing synthetic placeholder after real text does not emit text or zero out usage", () => {
    const { error: _error, ...base } = assistant()
    const synthetic: SDKAssistantMessage = {
      ...base,
      uuid: crypto.randomUUID(),
      message: {
        ...base.message,
        id: "synthetic-placeholder",
        model: "<synthetic>",
        stop_reason: "stop_sequence",
        usage: {
          ...base.message.usage,
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
        content: [{ type: "text", text: "No response requested.", citations: null }],
      },
    }
    const convert = ConvertClaudeStream.make([])
    const parts: LanguageModelV3StreamPart[] = []
    for (const line of Recorder.load("text")) {
      if (line.from !== "claude" || line.message.type === "control_response") continue
      if (line.message.type === "result") {
        expect(convert(synthetic)).toEqual([])
        parts.push(...convert(line.message as SDKMessage))
        break
      }
      parts.push(...convert(line.message as SDKMessage))
    }
    const text = parts
      .filter((part) => part.type === "text-delta")
      .map((part) => part.delta)
      .join("")
    expect(text).toBe("COPPER-OTTER")
    expect(parts.some((part) => part.type === "error")).toBe(false)
    const finish = parts.find((part) => part.type === "finish")
    if (!finish) throw new Error("Expected a finish part")
    const recorded = Recorder.result("text").usage
    expect(finish.usage.inputTokens).toEqual({
      total: recorded.input_tokens + recorded.cache_read_input_tokens + recorded.cache_creation_input_tokens,
      noCache: recorded.input_tokens,
      cacheRead: recorded.cache_read_input_tokens,
      cacheWrite: recorded.cache_creation_input_tokens,
    })
    expect(finish.usage.outputTokens.total).toBe(recorded.output_tokens)
  })
})
