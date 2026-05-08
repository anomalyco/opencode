import { describe, expect, test } from "bun:test"
import {
  LLM_ERROR_TYPES,
  type LLMErrorPayload,
  type SessionUpdateWithAgentError,
  isAgentErrorUpdate,
  isRetriable,
} from "../../src/acp/agent-error"

describe("isRetriable", () => {
  test.each([
    ["budget", false],
    ["context_overflow", false],
    ["auth", false],
    ["rate_limit", true],
    ["provider_unavailable", true],
    ["unknown", true],
  ] as const)("classifies %s as retriable=%s", (type, expected) => {
    expect(isRetriable(type)).toBe(expected)
  })

  test("LLM_ERROR_TYPES is the closed vocabulary", () => {
    expect(LLM_ERROR_TYPES).toEqual([
      "budget",
      "rate_limit",
      "provider_unavailable",
      "context_overflow",
      "auth",
      "unknown",
    ])
  })
})

describe("isAgentErrorUpdate", () => {
  const validBudgetPayload: LLMErrorPayload = {
    type: "budget",
    message: "Weekly budget exceeded",
    retryable: false,
    detail: { limitUsd: "1.0", consumedUsd: "1.004" },
    reset_at_epoch_ms: 1778457600000,
    source: "global",
  }

  test("narrows valid agent_error frames", () => {
    const update: unknown = {
      sessionUpdate: "agent_error",
      error: validBudgetPayload,
    }
    expect(isAgentErrorUpdate(update)).toBe(true)
    if (isAgentErrorUpdate(update)) {
      // Compile-time narrowing check: both fields are typed.
      expect(update.error.type).toBe("budget")
      expect(update.error.retryable).toBe(false)
    }
  })

  test("rejects other session/update kinds", () => {
    expect(isAgentErrorUpdate({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hi" } })).toBe(
      false,
    )
    expect(isAgentErrorUpdate({ sessionUpdate: "tool_call_update" })).toBe(false)
  })

  test("rejects missing or malformed payloads", () => {
    expect(isAgentErrorUpdate(undefined)).toBe(false)
    expect(isAgentErrorUpdate(null)).toBe(false)
    expect(isAgentErrorUpdate("agent_error")).toBe(false)
    expect(isAgentErrorUpdate({ sessionUpdate: "agent_error" })).toBe(false)
    expect(isAgentErrorUpdate({ sessionUpdate: "agent_error", error: null })).toBe(false)
    expect(isAgentErrorUpdate({ sessionUpdate: "agent_error", error: { type: "budget" } })).toBe(false)
    expect(
      isAgentErrorUpdate({
        sessionUpdate: "agent_error",
        error: { type: "not_a_real_type", message: "x", retryable: false },
      }),
    ).toBe(false)
  })

  test("JSON round-trip preserves shape", () => {
    const frame: SessionUpdateWithAgentError = {
      sessionUpdate: "agent_error",
      error: validBudgetPayload,
      stopReason: "error",
    }
    const decoded = JSON.parse(JSON.stringify(frame))
    expect(isAgentErrorUpdate(decoded)).toBe(true)
    if (isAgentErrorUpdate(decoded)) {
      expect(decoded.error.reset_at_epoch_ms).toBe(1778457600000)
      expect(decoded.error.source).toBe("global")
    }
  })
})

describe("SessionUpdateWithAgentError compile-time narrowing", () => {
  test("discriminated union narrows to AgentErrorUpdate by sessionUpdate literal", () => {
    const update: SessionUpdateWithAgentError = {
      sessionUpdate: "agent_error",
      error: {
        type: "rate_limit",
        message: "Slow down",
        retryable: true,
        retry_after_seconds: 12,
      },
    }
    if (update.sessionUpdate === "agent_error") {
      // This block must compile — i.e. update.error is typed as LLMErrorPayload.
      const _typeCheck: number | null | undefined = update.error.retry_after_seconds
      expect(_typeCheck).toBe(12)
    } else {
      throw new Error("union narrowing failed")
    }
  })
})
