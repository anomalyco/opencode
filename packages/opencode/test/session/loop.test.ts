import { describe, expect, test } from "bun:test"
import { create, recovery, isLoopOutcome, DEFAULTS, type LoopOutcome } from "../../src/session/loop"
import { Config } from "../../src/config/config"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repeat(s: string, n: number) {
  return s.repeat(n)
}

function drain(detector: ReturnType<typeof create>, text: string, chunk = 1) {
  let result: LoopOutcome | undefined
  for (let i = 0; i < text.length; i += chunk) {
    const r = detector.feed(text.slice(i, i + chunk))
    if (r) result = r
  }
  return result
}

// ---------------------------------------------------------------------------
// Detector — exact repeating block
// ---------------------------------------------------------------------------

describe("loop detector", () => {
  test("detects exact repeating block", () => {
    const block = "The quick brown fox jumps over the lazy dog. "
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 4))
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
    expect(result!.source).toBe("text")
  })

  test("detects near-identical block with similarity threshold", () => {
    const a = "The quick brown fox jumps over the lazy dog. "
    const b = "The quick brown fox jumps over the lazy cat. "
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 0.8,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, a + b)
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
  })

  test("no detection below min_chars", () => {
    const block = "abc "
    const detector = create({
      source: "text",
      min_period: 2,
      max_period: 20,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 9999,
    })
    const result = drain(detector, repeat(block, 10))
    expect(result).toBeUndefined()
  })

  test("no detection below min_period", () => {
    const block = "ab"
    const detector = create({
      source: "text",
      min_period: 100,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 60))
    expect(result).toBeUndefined()
  })

  test("no detection for punctuation/symbol repeats", () => {
    const detector = create({
      source: "text",
      min_period: 3,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    expect(drain(detector, repeat("---", 40))).toBeUndefined()
  })

  test("no detection for markdown table separator repeats", () => {
    const detector = create({
      source: "text",
      min_period: 3,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    expect(drain(detector, repeat("| --- ", 40))).toBeUndefined()
  })

  test("no detection for varied content", () => {
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const varied = Array.from({ length: 20 }, (_, i) => `Sentence number ${i} is unique. `).join("")
    expect(drain(detector, varied)).toBeUndefined()
  })

  test("detects long repeating block", () => {
    const block = "A".repeat(50) + " long block of text that repeats itself over and over. "
    const detector = create({
      source: "reasoning",
      min_period: 10,
      max_period: 2000,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 3))
    expect(result).toBeDefined()
    expect(result!.source).toBe("reasoning")
  })

  test("detects short repeating block", () => {
    const block = "hello world "
    const detector = create({
      source: "text",
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 10))
    expect(result).toBeDefined()
  })

  test("detects Unicode loop", () => {
    const block = "\u4F60\u597D\u4E16\u754C\u3002\u8FD9\u662F\u91CD\u590D\u7684\u5185\u5BB9\u3002"
    const detector = create({
      source: "text",
      min_period: 5,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(block, 6))
    expect(result).toBeDefined()
    expect(result!.type).toBe("loop")
  })

  test("filters Unicode punctuation-only repeats", () => {
    const detector = create({
      source: "text",
      min_period: 3,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    expect(drain(detector, repeat("\u3001\u3002\uFF01", 40))).toBeUndefined()
  })

  test("reset clears state", () => {
    const block = "repeating content here. "
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    // Feed enough to detect
    const first = drain(detector, repeat(block, 10))
    expect(first).toBeDefined()

    // Reset and feed non-repeating content
    detector.reset()
    const varied = Array.from({ length: 10 }, (_, i) => `Unique sentence ${i}. `).join("")
    expect(drain(detector, varied)).toBeUndefined()
  })

  test("on_detected callback fires", () => {
    const block = "callback test content. "
    const outcomes: LoopOutcome[] = []
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
      on_detected: (o) => outcomes.push(o),
    })
    drain(detector, repeat(block, 10))
    expect(outcomes.length).toBeGreaterThan(0)
    expect(outcomes[0].type).toBe("loop")
  })
})

// ---------------------------------------------------------------------------
// Recovery
// ---------------------------------------------------------------------------

describe("recovery", () => {
  test("attempt 0 returns nudge", () => {
    const r = recovery(0)
    expect(r.action).toBe("nudge")
    if (r.action === "nudge") {
      expect(typeof r.reminder).toBe("string")
      expect(r.reminder.length).toBeGreaterThan(0)
    }
  })

  test("attempt 1 returns abort (default max_nudges=1)", () => {
    const r = recovery(1)
    expect(r.action).toBe("abort")
    if (r.action === "abort") {
      expect(r.attempts).toBe(2)
    }
  })

  test("attempt 0 returns abort when max_nudges=0", () => {
    const r = recovery(0, { max_nudges: 0 })
    expect(r.action).toBe("abort")
    if (r.action === "abort") {
      expect(r.attempts).toBe(1)
    }
  })

  test("nudge reminder includes period", () => {
    const r = recovery(0, { period: 42 })
    if (r.action === "nudge") {
      expect(r.reminder).toContain("42")
    }
  })

  test("custom reminder template", () => {
    const r = recovery(0, { reminder: "Loop at {period} chars", period: 100 })
    if (r.action === "nudge") {
      expect(r.reminder).toBe("Loop at 100 chars")
    }
  })
})

// ---------------------------------------------------------------------------
// isLoopOutcome
// ---------------------------------------------------------------------------

describe("isLoopOutcome", () => {
  test("returns true for valid outcome", () => {
    expect(isLoopOutcome({ type: "loop", period: 10, source: "text" })).toBe(true)
  })

  test("returns false for non-objects", () => {
    expect(isLoopOutcome(null)).toBe(false)
    expect(isLoopOutcome(undefined)).toBe(false)
    expect(isLoopOutcome("loop")).toBe(false)
    expect(isLoopOutcome(42)).toBe(false)
  })

  test("returns false for wrong type field", () => {
    expect(isLoopOutcome({ type: "other" })).toBe(false)
    expect(isLoopOutcome({})).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Privacy — no raw text in outcome
// ---------------------------------------------------------------------------

describe("privacy", () => {
  test("outcome does not contain raw repeated text", () => {
    const secret = "sensitive data that should not leak. "
    const detector = create({
      source: "text",
      min_period: 10,
      max_period: 200,
      similarity: 1.0,
      check_interval: 1,
      min_chars: 0,
    })
    const result = drain(detector, repeat(secret, 10))
    expect(result).toBeDefined()
    const json = JSON.stringify(result)
    expect(json).not.toContain("sensitive")
    expect(json).not.toContain("leak")
  })
})

// ---------------------------------------------------------------------------
// Config validation — loop schema
// ---------------------------------------------------------------------------

describe("loop config validation", () => {
  const loop = Config.Info.shape.experimental.unwrap().shape.loop

  test("accepts valid config", () => {
    const result = loop.safeParse({ min_period: 10, max_period: 100, similarity: 0.9 })
    expect(result.success).toBe(true)
  })

  test("rejects min_period > max_period", () => {
    const result = loop.safeParse({ min_period: 200, max_period: 100 })
    expect(result.success).toBe(false)
  })

  test("accepts min_period == max_period", () => {
    const result = loop.safeParse({ min_period: 50, max_period: 50 })
    expect(result.success).toBe(true)
  })

  test("rejects similarity > 1", () => {
    const result = loop.safeParse({ similarity: 1.5 })
    expect(result.success).toBe(false)
  })

  test("rejects similarity < 0", () => {
    const result = loop.safeParse({ similarity: -0.1 })
    expect(result.success).toBe(false)
  })

  test("accepts similarity at boundaries", () => {
    expect(loop.safeParse({ similarity: 0 }).success).toBe(true)
    expect(loop.safeParse({ similarity: 1 }).success).toBe(true)
  })

  test("accepts empty config", () => {
    expect(loop.safeParse({}).success).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// DEFAULTS
// ---------------------------------------------------------------------------

describe("DEFAULTS", () => {
  test("has expected keys", () => {
    expect(DEFAULTS.min_period).toBeGreaterThan(0)
    expect(DEFAULTS.max_period).toBeGreaterThan(DEFAULTS.min_period)
    expect(DEFAULTS.similarity).toBeGreaterThanOrEqual(0)
    expect(DEFAULTS.similarity).toBeLessThanOrEqual(1)
    expect(DEFAULTS.check_interval).toBeGreaterThan(0)
    expect(DEFAULTS.min_chars).toBeGreaterThan(0)
    expect(DEFAULTS.max_nudges).toBeGreaterThanOrEqual(0)
  })
})
