import { describe, expect, test } from "bun:test"
import { shouldUseResponsesApi } from "@opencode-ai/ai/providers/github-copilot"

describe("GitHub Copilot", () => {
  test("selects the endpoint from explicit metadata before the model ID fallback", () => {
    expect(shouldUseResponsesApi("mai-code-1-flash-picker", "responses")).toBe(true)
    expect(shouldUseResponsesApi("gpt-5", "chat")).toBe(false)
    expect(shouldUseResponsesApi("gpt-5")).toBe(true)
    expect(shouldUseResponsesApi("gpt-5.1-codex")).toBe(true)
    expect(shouldUseResponsesApi("gpt-4o")).toBe(false)
    expect(shouldUseResponsesApi("gpt-5-mini")).toBe(false)
    expect(shouldUseResponsesApi("gpt-5-mini-2025-08-07")).toBe(false)
  })
})
