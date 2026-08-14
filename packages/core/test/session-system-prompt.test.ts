import { expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode-ai/core/session/system-prompt"

test("renders the default system prompt instructions", () => {
  const prompt = SessionSystemPrompt.make(["read", "shell"])
  expect(prompt).not.toContain("${OPENCODE_TOOL_INSTRUCTIONS}")
  expect(prompt).not.toContain("${OPENCODE_INSTRUCTIONS}")
})
