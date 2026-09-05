import { describe, expect, test } from "bun:test"
import { containsHedge } from "@opencode-ai/core/session/runner/hedge"

describe("containsHedge", () => {
  test("matches real hedges", () => {
    expect(containsHedge("I think this is the problem.")).toBe(true)
    expect(containsHedge("It might work if we restart.")).toBe(true)
    expect(containsHedge("Perhaps we should check the database.")).toBe(true)
    expect(containsHedge("This is likely caused by network latency.")).toBe(true)
    expect(containsHedge("Maybe we can try a different approach.")).toBe(true)
  })

  test("does not match substrings in other words (word-boundary check)", () => {
    expect(containsHedge("The algorithm is fast.")).toBe(false)
    expect(containsHedge("He gave a mighty push.")).toBe(false)
    expect(containsHedge("The almighty power.")).toBe(false)
    expect(containsHedge("She wore Maybelline makeup.")).toBe(false)
  })

  test("ignores code blocks, inline code, and blockquotes", () => {
    expect(containsHedge("Here is the code:\n```\nconst might = true\n```")).toBe(false)
    expect(containsHedge("Check the `maybe` variable.")).toBe(false)
    expect(containsHedge("> perhaps we can do this\nThis is definite.")).toBe(false)
  })
})
