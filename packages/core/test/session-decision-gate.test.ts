import { describe, expect, test } from "bun:test"
import { SessionDecisionGate } from "@opencode/core/session/decision-gate"

describe("SessionDecisionGate.decide", () => {
  test("treats greetings, thanks, and acknowledgements as plain chat", () => {
    for (const text of ["hi", "Hello!", "  thanks  ", "Thank you so much 🙏", "OK.", "got it", "Sounds good!"])
      expect(SessionDecisionGate.decide(text)).toEqual({ kind: "chat", confidence: 0.95 })
  })

  test("sends anything else to the model", () => {
    for (const text of [
      "hi, can you fix the build?",
      "thanks, now run the tests",
      "ok go",
      "what does this file do",
      "",
      `${"thanks ".repeat(10)}`,
    ])
      expect(SessionDecisionGate.decide(text)).toEqual({ kind: "model", confidence: 1 })
  })
})
