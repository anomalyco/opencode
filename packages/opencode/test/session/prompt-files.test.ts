import { describe, expect, it } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// Resolves to packages/opencode/src/session/prompt regardless of where bun is invoked from.
const promptDir = path.join(import.meta.dir, "../../src/session/prompt")

describe("system prompt files", () => {
  // Regression for #38332: gpt.txt told the model to "Use `multi_tool_use.parallel`
  // to parallelize tool calls". `multi_tool_use.parallel` is an OpenAI legacy
  // pseudo-tool from the old parallel function-calling shim; opencode's provider
  // adapters do not expose it, so models that followed the instruction attempted
  // to call a tool that does not exist (surfacing as failed tool calls).
  // Other prompts (anthropic/gemini/codex/...) already describe the correct
  // mechanism — "send a single message with multiple tool calls".
  it("no prompt references the multi_tool_use.parallel pseudo-tool", () => {
    const files = readdirSync(promptDir).filter((file) => file.endsWith(".txt"))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const content = readFileSync(path.join(promptDir, file), "utf8")
      expect(content, `prompt file ${file} references multi_tool_use.parallel`).not.toContain(
        "multi_tool_use.parallel",
      )
    }
  })
})
