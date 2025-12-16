import { describe, expect, test } from "bun:test"
import { resolvePrompt } from "@/cli/cmd/agent-context"

describe("resolvePrompt", () => {
  test("uses explicit prompt string", () => {
    expect(resolvePrompt({ prompt: "say hi" })).toBe("say hi")
  })

  test("joins prompt array", () => {
    expect(resolvePrompt({ prompt: ["find", "todos"], agent: "claude" })).toBe("find todos")
  })

  test("uses positional prompt after agent", () => {
    expect(resolvePrompt({ _: ["claude", "what now"], agent: "name=claude" })).toBe("what now")
  })

  test("falls back to print value when it captured the prompt", () => {
    expect(resolvePrompt({ print: "what is the capital of spain", _: ["claude"], agent: "name=claude" })).toBe(
      "what is the capital of spain",
    )
  })
})
