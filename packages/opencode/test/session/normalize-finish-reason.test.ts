import { describe, expect, test } from "bun:test"
import { SessionProcessor } from "../../src/session/processor"

describe("normalizeFinishReason", () => {
  test("tool_calls without tool deltas maps to stop", () => {
    expect(SessionProcessor.normalizeFinishReason("tool-calls", false)).toBe("stop")
  })

  test("tool_calls with tool deltas stays tool-calls", () => {
    expect(SessionProcessor.normalizeFinishReason("tool-calls", true)).toBe("tool-calls")
  })

  test("unknown without tool deltas maps to stop", () => {
    expect(SessionProcessor.normalizeFinishReason("unknown", false)).toBe("stop")
  })

  test("other reasons are unchanged", () => {
    expect(SessionProcessor.normalizeFinishReason("length", false)).toBe("length")
  })
})
