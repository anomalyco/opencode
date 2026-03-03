import { describe, expect, test } from "bun:test"
import { ThinkingLoopDetector, getRecoveryAction } from "../../src/session/thinking-loop"

describe("session.thinking-loop.detector", () => {
  test("detects repeated reasoning block", () => {
    const detector = new ThinkingLoopDetector({
      min_period: 20,
      max_period: 200,
      check_interval: 1,
      min_chars_before_detection: 1,
      min_unique_chars: 5,
    })
    const chunk = "Looking at the code, we should call the tool now. "
    const input = chunk.repeat(3)
    const result = detector.feed(input)
    expect(result?.type).toBe("thinking_loop")
    expect(result?.period).toBeGreaterThanOrEqual(20)
  })

  test("does not detect for low entropy repeated punctuation", () => {
    const detector = new ThinkingLoopDetector({
      min_period: 10,
      max_period: 100,
      check_interval: 1,
      min_chars_before_detection: 1,
      min_unique_chars: 5,
    })
    const result = detector.feed("!!!\n!!!\n!!!\n!!!\n!!!\n!!!\n")
    expect(result).toBeUndefined()
  })

  test("does not detect when repeated block has no alphanumeric chars", () => {
    const detector = new ThinkingLoopDetector({
      min_period: 6,
      max_period: 40,
      check_interval: 1,
      min_chars_before_detection: 1,
      min_unique_chars: 2,
    })
    const block = "--- *** --- "
    const result = detector.feed(block.repeat(3))
    expect(result).toBeUndefined()
  })
})

describe("session.thinking-loop.recovery", () => {
  test("escalates nudge -> compact -> abort", () => {
    const first = getRecoveryAction(0, 120, {
      max_nudges: 1,
      max_compacts: 1,
    })
    const second = getRecoveryAction(1, 120, {
      max_nudges: 1,
      max_compacts: 1,
    })
    const third = getRecoveryAction(2, 120, {
      max_nudges: 1,
      max_compacts: 1,
    })

    expect(first.type).toBe("nudge")
    expect(second.type).toBe("compact")
    expect(third.type).toBe("abort")
    if (third.type === "abort") {
      expect(third.period).toBe(120)
      expect(third.attempts).toBe(3)
    }
  })
})
