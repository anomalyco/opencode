import { describe, expect, test } from "bun:test"
import type { LanguageModelV3StreamPart } from "@ai-sdk/provider"
import type { SDKAssistantMessage, SDKMessage, SDKRateLimitEvent } from "@anthropic-ai/claude-agent-sdk"
import { ConvertClaudeStream } from "@opencode/core/plugin/provider/claude-agent/language-model/convert-claude-stream"
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
})
