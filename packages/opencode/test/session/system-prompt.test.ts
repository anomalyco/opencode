import { describe, expect, test } from "bun:test"

import PROMPT_DEFAULT from "../../src/session/prompt/default.txt"
import PROMPT_GPT from "../../src/session/prompt/gpt.txt"
import PROMPT_BEAST from "../../src/session/prompt/beast.txt"
import PROMPT_CODEX from "../../src/session/prompt/codex.txt"
import PROMPT_ANTHROPIC from "../../src/session/prompt/anthropic.txt"
import PROMPT_GEMINI from "../../src/session/prompt/gemini.txt"
import PROMPT_KIMI from "../../src/session/prompt/kimi.txt"
import PROMPT_TRINITY from "../../src/session/prompt/trinity.txt"

describe("system prompt", () => {
  test("includes long-running process bash steering", () => {
    const prompts = [
      PROMPT_DEFAULT,
      PROMPT_GPT,
      PROMPT_BEAST,
      PROMPT_CODEX,
      PROMPT_ANTHROPIC,
      PROMPT_GEMINI,
      PROMPT_KIMI,
      PROMPT_TRINITY,
    ]

    for (const prompt of prompts) {
      expect(prompt).toContain("Do not use the bash tool to start foreground long-running processes")
      expect(prompt).toContain("Ask them to run it in their own terminal")
      expect(prompt).toContain("confirm it is running")
    }
  })
})
