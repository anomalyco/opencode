import { describe, expect, test } from "bun:test"
import { attentionState } from "./status-badge"

describe("attentionState", () => {
  test("stale outranks pending input, failure, and blocked work", () => {
    expect(attentionState({ stale: true, needsInput: 2, failed: 3, blocked: 4 })).toBe("stale")
  })

  test("pending input outranks failure and blocked work", () => {
    expect(attentionState({ stale: false, needsInput: 1, failed: 3, blocked: 4 })).toBe("needs_input")
  })

  test("failure outranks blocked work", () => {
    expect(attentionState({ stale: false, needsInput: 0, failed: 2, blocked: 4 })).toBe("failed")
  })

  test("blocked work outranks normal", () => {
    expect(attentionState({ stale: false, needsInput: 0, failed: 0, blocked: 1 })).toBe("blocked")
  })

  test("normal when nothing needs attention", () => {
    expect(attentionState({ stale: false, needsInput: 0, failed: 0, blocked: 0 })).toBe("normal")
  })
})
